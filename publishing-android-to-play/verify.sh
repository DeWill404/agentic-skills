#!/usr/bin/env bash
# Release gates for an Android App Bundle bound for Google Play.
#
# Every check here is mechanical: it reads the artifact you are about to upload
# and compares it against recorded state. Nothing is inferred from the build
# config, because the config is not what ships.
#
#   ./verify.sh <path-to.aab> [path-to-.play-release.md]
#
# Exit 0 only when every gate passes. WARN never fails the run.

set -uo pipefail

AAB="${1:-}"
STATE="${2:-}"

[ -n "$AAB" ] || { echo "usage: verify.sh <path-to.aab> [state-file]" >&2; exit 2; }

FAILED=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; }
skip() { printf '  \033[90mSKIP\033[0m  %s\n' "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1 ($2)" >&2; exit 2; }; }
need bundletool "brew install bundletool"
need jarsigner  "a JDK - brew install openjdk@17"
need unzip      "ships with macOS"

# state file lookups. Absent keys are not failures - a first release has no
# history to compare against, and saying so beats inventing a baseline.
state() { [ -n "$STATE" ] && [ -f "$STATE" ] && sed -n "s/^$1:[[:space:]]*//p" "$STATE" | head -1; }

echo
echo "verifying $(basename "$AAB")"
echo

# ---------------------------------------------------------------- artifact
if [ ! -s "$AAB" ]; then
  fail "file exists and is non-empty"
  echo; exit 1
fi
pass "file exists ($(du -h "$AAB" | cut -f1))"

# An AAB carries BundleConfig.pb at its root; an APK carries AndroidManifest.xml
# there instead. Both contain base/dex/classes.dex, so dex is not a
# discriminator - this mistake produces an "upload an AAB" rejection that reads
# as though the file were corrupt.
LISTING=$(unzip -l "$AAB" 2>/dev/null)
if grep -q 'BundleConfig\.pb' <<<"$LISTING"; then
  pass "artifact is an app bundle, not an APK"
elif grep -qE '^\s+[0-9]+\s+.*\sAndroidManifest\.xml$' <<<"$LISTING"; then
  fail "artifact is an APK - Play's standard tracks require an .aab (use bundleRelease, not assembleRelease)"
  echo; exit 1
else
  fail "artifact is not a recognisable AAB or APK"
  echo; exit 1
fi

# --------------------------------------------------------------- signature
# The single most common rejection. A release build that silently inherits the
# debug signingConfig looks completely normal until Play refuses it.
CERTS=$(jarsigner -verify -certs -verbose "$AAB" 2>&1)
if grep -q 'jar is unsigned' <<<"$CERTS"; then
  fail "bundle is unsigned"
elif grep -q 'CN=Android Debug' <<<"$CERTS"; then
  fail "signed with the DEBUG key (CN=Android Debug) - Play will reject this"
else
  SIGNER=$(grep -o 'CN=[^,]*' <<<"$CERTS" | head -1)
  pass "signed with a release key (${SIGNER:-unknown CN})"
fi

# ---------------------------------------------------------------- manifest
MANIFEST=$(bundletool dump manifest --bundle="$AAB" 2>/dev/null)
if [ -z "$MANIFEST" ]; then
  fail "could not read the bundle manifest"
  echo; exit 1
fi

attr() { grep -o "$1=\"[^\"]*\"" <<<"$MANIFEST" | head -1 | sed "s/.*=\"//; s/\"$//"; }
PKG=$(attr 'package')
VCODE=$(attr 'android:versionCode')
VNAME=$(attr 'android:versionName')
TSDK=$(attr 'android:targetSdkVersion')

# ----------------------------------------------------------------- package
EXPECT_PKG=$(state package)
if [ -z "$EXPECT_PKG" ]; then
  skip "package match (no package recorded yet) - bundle declares $PKG"
elif [ "$PKG" = "$EXPECT_PKG" ]; then
  pass "package is $PKG"
else
  fail "package is $PKG but state expects $EXPECT_PKG - wrong project, flavour, or build variant"
fi

# ------------------------------------------------------------- versionCode
# Play rejects a versionCode equal to or below anything already uploaded to any
# track. The trap this catches is a stale artifact left behind by a failed
# build: it looks fresh on disk and carries the previous release's code.
LAST=$(state last_uploaded_versionCode)
if [ -z "$LAST" ]; then
  skip "versionCode increment (nothing uploaded yet) - this bundle is $VCODE"
elif [ "$VCODE" -gt "$LAST" ] 2>/dev/null; then
  pass "versionCode $VCODE > last uploaded $LAST"
else
  fail "versionCode $VCODE must be greater than last uploaded $LAST (stale artifact, or the bump was never made)"
fi

# ---------------------------------------------------------------- targetSdk
FLOOR=$(state target_sdk_floor)
CHECKED=$(state target_sdk_floor_checked)
if [ -z "$FLOOR" ]; then
  skip "targetSdk floor (none recorded) - bundle targets $TSDK"
elif [ "$TSDK" -ge "$FLOOR" ] 2>/dev/null; then
  pass "targetSdk $TSDK meets the recorded floor of $FLOOR"
else
  fail "targetSdk $TSDK is below Play's floor of $FLOOR"
fi

# Google raises the floor annually, so a stale number is a confidently wrong
# number. Past six months, stop trusting the recorded value.
if [ -n "$CHECKED" ]; then
  AGE=$(python3 -c "
import datetime,sys
try:
    d=datetime.date.fromisoformat('$CHECKED')
    print((datetime.date.today()-d).days)
except Exception:
    print(-1)
" 2>/dev/null)
  if [ "${AGE:--1}" -gt 180 ] 2>/dev/null; then
    warn "the targetSdk floor was last confirmed $AGE days ago - re-check Play's current requirement before trusting it"
  fi
fi

# -------------------------------------------------------------- permissions
# A dependency bump can add a permission nobody asked for. Users see every one
# of them on the store listing, and some (AD_ID) pull extra declarations into
# scope. Diffing against a recorded baseline surfaces the change while it is
# still cheap to remove.
PERMS=$(grep -o 'android:name="android\.permission\.[^"]*"' <<<"$MANIFEST" \
        | sed 's/.*="//; s/"$//' | sort -u)
BASE=$(sed -n 's/^perm:[[:space:]]*//p' "${STATE:-/dev/null}" 2>/dev/null | sort -u)

if [ -z "$BASE" ]; then
  skip "permission diff (no baseline recorded). This bundle declares:"
  sed 's/^/          /' <<<"$PERMS"
else
  ADDED=$(comm -13 <(echo "$BASE") <(echo "$PERMS"))
  REMOVED=$(comm -23 <(echo "$BASE") <(echo "$PERMS"))
  if [ -z "$ADDED" ] && [ -z "$REMOVED" ]; then
    pass "permissions unchanged from the recorded baseline"
  else
    [ -n "$ADDED" ]   && warn "permissions ADDED since last release:$(printf '\n          %s' $ADDED)"
    [ -n "$REMOVED" ] && warn "permissions removed since last release:$(printf '\n          %s' $REMOVED)"
    warn "confirm each addition is intended - added permissions are visible to users on the listing"
  fi
fi

# ------------------------------------------------------------- obfuscation
# Play warns "There is no deobfuscation file associated with this App Bundle"
# on every bundle lacking a mapping, and cannot tell the two cases apart:
#
#   R8 never ran            -> benign. This is the DEFAULT for Expo and React
#                              Native (`android.enableMinifyInReleaseBuilds`
#                              is unset), so most users meet this warning on
#                              their first upload with no way to judge it.
#   R8 ran, map not shipped -> serious, and permanent for that release. Every
#                              crash and ANR arrives as single-letter class
#                              names.
#
# The bundle separates them without consulting the build config: AGP embeds the
# map under BUNDLE-METADATA when R8 runs, and obfuscated code leaves short class
# descriptors (La;, Lb/c;) in the dex where readable code leaves none.
if grep -q 'BUNDLE-METADATA/com\.android\.tools\.build\.obfuscation' <<<"$LISTING"; then
  pass "deobfuscation map embedded - Play will symbolicate crash reports"
elif ! command -v strings >/dev/null 2>&1; then
  skip "obfuscation check (\`strings\` unavailable) - no map embedded, which is benign only if R8 is off"
else
  DEXDIR=$(mktemp -d)
  unzip -o -q "$AAB" 'base/dex/*.dex' -d "$DEXDIR" 2>/dev/null
  SHORT=$(cat "$DEXDIR"/base/dex/*.dex 2>/dev/null | strings -a \
          | grep -cE '^L[a-z]{1,2}(/[a-z]{1,2})*;$')
  rm -rf "$DEXDIR"
  if [ "${SHORT:-0}" -gt 50 ]; then
    fail "obfuscated ($SHORT minified class names) but no mapping embedded - crash reports will be unreadable. Upload android/app/build/outputs/mapping/release/mapping.txt against this release in Play Console"
  else
    pass "not obfuscated (R8 off) - Play's \"no deobfuscation file\" warning is expected and can be ignored"
  fi
fi

# AD_ID is called out separately because it is the one permission confirmed to
# pull a declaration requirement onto the internal testing track.
if grep -q 'com\.google\.android\.gms\.permission\.AD_ID' <<<"$MANIFEST"; then
  warn "AD_ID permission present - Play Console requires the advertising ID declaration, internal track included"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mall gates passed\033[0m  %s  versionCode %s (%s)  targetSdk %s\n\n' "$PKG" "$VCODE" "$VNAME" "$TSDK"
else
  printf '\033[31mblocked - fix the failures above before uploading\033[0m\n\n'
fi
exit $FAILED
