const { SOURCE_URLS } = require('./source-urls');

function files(ctx) {
  return Array.isArray(ctx.files) ? ctx.files : [];
}

function fileContent(ctx, filePath) {
  return typeof ctx.fileContent === 'function' ? (ctx.fileContent(filePath) || '') : '';
}

function matchingFiles(ctx, pattern) {
  return files(ctx).filter((file) => {
    pattern.lastIndex = 0;
    return pattern.test(file);
  });
}

function hasMatchingFile(ctx, pattern) {
  return matchingFiles(ctx, pattern).length > 0;
}

function readMatchingFiles(ctx, pattern) {
  return matchingFiles(ctx, pattern)
    .map((file) => fileContent(ctx, file))
    .filter(Boolean)
    .join('\n');
}

function docsText(ctx, docs) {
  return String(docs ? docs(ctx) || '' : '');
}

function workflowText(ctx) {
  return matchingFiles(ctx, /(^|[\\/])\.github[\\/]workflows[\\/].+\.ya?ml$/i)
    .map((file) => fileContent(ctx, file))
    .filter(Boolean)
    .join('\n');
}

function projectText(ctx, docs) {
  return [docsText(ctx, docs), workflowText(ctx)].filter(Boolean).join('\n');
}

function pubspecText(ctx) {
  return readMatchingFiles(ctx, /(^|[\\/])pubspec\.yaml$/i);
}

function hasFlutterSurface(ctx) {
  return hasMatchingFile(ctx, /(^|[\\/])pubspec\.yaml$/i);
}

function hasSwiftSurface(ctx) {
  return hasMatchingFile(ctx, /(^|[\\/])Package\.swift$/i) ||
    hasMatchingFile(ctx, /\.xcodeproj([\\/]|$)/i) ||
    hasMatchingFile(ctx, /(^|[\\/])project\.pbxproj$/i);
}

function swiftConfigText(ctx) {
  return [
    readMatchingFiles(ctx, /(^|[\\/])Package\.swift$/i),
    readMatchingFiles(ctx, /(^|[\\/])Podfile$/i),
    readMatchingFiles(ctx, /(^|[\\/])project\.pbxproj$/i),
    readMatchingFiles(ctx, /(^|[\\/])\.swift-version$/i),
  ].filter(Boolean).join('\n');
}

function hasAndroidKotlinSurface(ctx) {
  const gradleFiles = matchingFiles(ctx, /(^|[\\/])build\.gradle\.kts$/i);
  if (!gradleFiles.length) return false;

  return gradleFiles.some((file) => {
    const content = fileContent(ctx, file);
    return /android\s*\{|com\.android\.(?:application|library)|id\(["']com\.android\.(?:application|library)["']\)/i.test(content);
  });
}

function androidGradleText(ctx) {
  return [
    readMatchingFiles(ctx, /(^|[\\/])build\.gradle\.kts$/i),
    readMatchingFiles(ctx, /(^|[\\/])settings\.gradle\.kts$/i),
    readMatchingFiles(ctx, /(^|[\\/])gradle[\\/]libs\.versions\.toml$/i),
    fileContent(ctx, 'gradle.properties'),
  ].filter(Boolean).join('\n');
}

function flutterStateManagementPresent(ctx) {
  const pubspec = pubspecText(ctx);
  return /flutter_riverpod|hooks_riverpod|riverpod|flutter_bloc|bloc|provider|getx|mobx|stacked/i.test(pubspec);
}

function flutterCodegenPresent(ctx) {
  return /build_runner|freezed|json_serializable|injectable_generator|drift_dev/i.test(pubspecText(ctx)) ||
    hasMatchingFile(ctx, /(^|[\\/]).+\.g\.dart$/i);
}

function flutterBackendIntegrationPresent(ctx) {
  return /firebase_|cloud_firestore|firebase_core|supabase_flutter|supabase/i.test(pubspecText(ctx)) ||
    hasMatchingFile(ctx, /(^|[\\/])google-services\.json$/i) ||
    hasMatchingFile(ctx, /(^|[\\/])GoogleService-Info\.plist$/i) ||
    hasMatchingFile(ctx, /(^|[\\/])firebase_options\.dart$/i);
}

function flutterPlatformSurface(ctx) {
  return hasMatchingFile(ctx, /(^|[\\/])android([\\/]|$)/i) ||
    hasMatchingFile(ctx, /(^|[\\/])ios([\\/]|$)/i);
}

function flutterCiSurface(ctx) {
  return hasMatchingFile(ctx, /(^|[\\/])fastlane([\\/]|$)/i) ||
    hasMatchingFile(ctx, /(^|[\\/])codemagic\.yaml$/i) ||
    /fastlane|codemagic|flutter build (?:apk|appbundle|ipa|ios|android)|flutter test/i.test(workflowText(ctx));
}

function swiftUiSignals(ctx) {
  return readMatchingFiles(ctx, /(^|[\\/]).+\.swift$/i);
}

function kotlinComposeSignals(ctx) {
  return [
    androidGradleText(ctx),
    readMatchingFiles(ctx, /(^|[\\/]).+\.kt$/i),
  ].filter(Boolean).join('\n');
}

function makeCheck({ platform, id, name, category, impact, fix, check }) {
  return {
    id,
    name,
    check,
    impact,
    category,
    fix,
    sourceUrl: SOURCE_URLS[platform]?.byCategory?.[category] || SOURCE_URLS[platform]?.defaultUrl,
    confidence: 0.7,
  };
}

function buildStackChecks({ platform, objectPrefix, idPrefix, docs }) {
  const makeId = (family, number) => `${idPrefix}-${family}${String(number).padStart(2, '0')}`;
  const makeKey = (suffix) => `${objectPrefix}${suffix}`;

  return {
    [makeKey('FlutterPubspecExists')]: makeCheck({
      platform,
      id: makeId('FL', 1),
      name: 'pubspec.yaml exists',
      category: 'flutter',
      impact: 'high',
      fix: 'Add a committed `pubspec.yaml` at the Flutter project root so tooling, dependencies, and instructions have a canonical manifest.',
      check: (ctx) => hasFlutterSurface(ctx) ? true : null,
    }),
    [makeKey('FlutterPubspecLockCommitted')]: makeCheck({
      platform,
      id: makeId('FL', 2),
      name: 'pubspec.lock committed',
      category: 'flutter',
      impact: 'medium',
      fix: 'Commit `pubspec.lock` so Flutter package resolution stays reproducible for contributors and agents.',
      check: (ctx) => hasFlutterSurface(ctx) ? hasMatchingFile(ctx, /(^|[\\/])pubspec\.lock$/i) : null,
    }),
    [makeKey('FlutterVersionSpecified')]: makeCheck({
      platform,
      id: makeId('FL', 3),
      name: 'Flutter version specified (.fvmrc or pubspec)',
      category: 'flutter',
      impact: 'high',
      fix: 'Specify the Flutter SDK version with `.fvmrc` or an explicit SDK constraint in `pubspec.yaml`.',
      check: (ctx) => {
        if (!hasFlutterSurface(ctx)) return null;
        const pubspec = pubspecText(ctx);
        return hasMatchingFile(ctx, /(^|[\\/])\.fvmrc$/i) ||
          /environment:[\s\S]{0,300}(sdk|flutter)\s*:\s*["'][^"']+["']/i.test(pubspec);
      },
    }),
    [makeKey('FlutterTestDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 4),
      name: 'flutter test documented',
      category: 'flutter',
      impact: 'high',
      fix: 'Document `flutter test` in repo instructions or CI so contributors and agents have a shared verification command.',
      check: (ctx) => hasFlutterSurface(ctx)
        ? /\bflutter test\b/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('FlutterAnalyzeDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 5),
      name: 'flutter analyze documented',
      category: 'flutter',
      impact: 'high',
      fix: 'Document `flutter analyze` in project instructions or automation so static analysis is part of the default loop.',
      check: (ctx) => hasFlutterSurface(ctx)
        ? /\bflutter analyze\b/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('FlutterAnalysisOptionsConfigured')]: makeCheck({
      platform,
      id: makeId('FL', 6),
      name: 'analysis_options.yaml configured',
      category: 'flutter',
      impact: 'high',
      fix: 'Add `analysis_options.yaml` to define lint rules and analyzer behavior for the Flutter codebase.',
      check: (ctx) => hasFlutterSurface(ctx)
        ? hasMatchingFile(ctx, /(^|[\\/])analysis_options\.ya?ml$/i)
        : null,
    }),
    [makeKey('FlutterBuildFlavorsDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 7),
      name: 'Build flavors documented (dev/staging/prod)',
      category: 'flutter',
      impact: 'medium',
      fix: 'Document build flavors such as dev, staging, and prod so mobile builds and environment routing stay predictable.',
      check: (ctx) => hasFlutterSurface(ctx)
        ? /flavor|flavours|dev|staging|prod|production/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('FlutterPlatformCodeDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 8),
      name: 'Platform-specific code documented (android/ios)',
      category: 'flutter',
      impact: 'medium',
      fix: 'Document Android and iOS specific code paths, native bridges, or platform setup in repo guidance.',
      check: (ctx) => {
        if (!hasFlutterSurface(ctx)) return null;
        if (!flutterPlatformSurface(ctx)) return null;
        return /android|ios|platform.?specific|method channel|native code/i.test(projectText(ctx, docs));
      },
    }),
    [makeKey('FlutterStateManagementDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 9),
      name: 'State management documented (Riverpod/Bloc/Provider in deps)',
      category: 'flutter',
      impact: 'medium',
      fix: 'Document the chosen Flutter state-management approach when Riverpod, Bloc, Provider, or similar packages are in use.',
      check: (ctx) => {
        if (!hasFlutterSurface(ctx)) return null;
        if (!flutterStateManagementPresent(ctx)) return null;
        return /riverpod|flutter_bloc|bloc|provider|getx|mobx|state management/i.test(projectText(ctx, docs));
      },
    }),
    [makeKey('FlutterCodeGenerationDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 10),
      name: 'Code generation documented (build_runner in devDeps)',
      category: 'flutter',
      impact: 'medium',
      fix: 'Document `build_runner` or the generated-code workflow when the app uses Dart code generation.',
      check: (ctx) => {
        if (!hasFlutterSurface(ctx)) return null;
        if (!flutterCodegenPresent(ctx)) return null;
        return /build_runner|codegen|generated code|freezed|json_serializable/i.test(projectText(ctx, docs));
      },
    }),
    [makeKey('FlutterLocalizationConfigured')]: makeCheck({
      platform,
      id: makeId('FL', 11),
      name: 'Localization configured (l10n.yaml)',
      category: 'flutter',
      impact: 'medium',
      fix: 'Add `l10n.yaml` when the app uses Flutter localization so the i18n pipeline is explicit and reproducible.',
      check: (ctx) => hasFlutterSurface(ctx)
        ? hasMatchingFile(ctx, /(^|[\\/])l10n\.ya?ml$/i)
        : null,
    }),
    [makeKey('FlutterFirebaseOrSupabaseDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 12),
      name: 'Firebase/Supabase configuration documented',
      category: 'flutter',
      impact: 'high',
      fix: 'Document Firebase or Supabase setup, environment binding, and client configuration when those services are present.',
      check: (ctx) => {
        if (!hasFlutterSurface(ctx)) return null;
        if (!flutterBackendIntegrationPresent(ctx)) return null;
        return /firebase|supabase|google-services|GoogleService-Info|firebase_options/i.test(projectText(ctx, docs));
      },
    }),
    [makeKey('FlutterAppSigningDocumented')]: makeCheck({
      platform,
      id: makeId('FL', 13),
      name: 'App signing documented',
      category: 'flutter',
      impact: 'high',
      fix: 'Document Android keystores and iOS signing/provisioning so release builds do not depend on tribal knowledge.',
      check: (ctx) => hasFlutterSurface(ctx)
        ? /signing|keystore|provisioning|certificate|bundle identifier|team id/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('FlutterCiCdMobile')]: makeCheck({
      platform,
      id: makeId('FL', 14),
      name: 'CI/CD for mobile (Fastlane/Codemagic)',
      category: 'flutter',
      impact: 'medium',
      fix: 'Add Fastlane, Codemagic, or equivalent mobile CI/CD automation for repeatable Flutter delivery.',
      check: (ctx) => hasFlutterSurface(ctx)
        ? flutterCiSurface(ctx)
        : null,
    }),
    [makeKey('FlutterGitignore')]: makeCheck({
      platform,
      id: makeId('FL', 15),
      name: 'Platform-specific .gitignore',
      category: 'flutter',
      impact: 'medium',
      fix: 'Add Flutter-specific ignore rules such as `.dart_tool/`, `.flutter-plugins*`, and platform build outputs to `.gitignore`.',
      check: (ctx) => {
        if (!hasFlutterSurface(ctx)) return null;
        const gitignore = fileContent(ctx, '.gitignore');
        return /\.dart_tool\/|\.flutter-plugins|\.flutter-plugins-dependencies|android\/key\.properties|ios\/Flutter\/ephemeral|build\//i.test(gitignore);
      },
    }),

    [makeKey('SwiftPackageOrXcodeprojExists')]: makeCheck({
      platform,
      id: makeId('SW', 1),
      name: 'Package.swift or .xcodeproj exists',
      category: 'swift',
      impact: 'high',
      fix: 'Commit `Package.swift` or the Xcode project so the Swift/iOS build surface is explicit and reproducible.',
      check: (ctx) => hasSwiftSurface(ctx) ? true : null,
    }),
    [makeKey('SwiftVersionSpecified')]: makeCheck({
      platform,
      id: makeId('SW', 2),
      name: 'Swift version specified (.swift-version)',
      category: 'swift',
      impact: 'high',
      fix: 'Specify the Swift toolchain with `.swift-version` or a `swift-tools-version` declaration.',
      check: (ctx) => {
        if (!hasSwiftSurface(ctx)) return null;
        return hasMatchingFile(ctx, /(^|[\\/])\.swift-version$/i) ||
          /swift-tools-version:\s*\d+(?:\.\d+)+/i.test(swiftConfigText(ctx));
      },
    }),
    [makeKey('SwiftLintConfigured')]: makeCheck({
      platform,
      id: makeId('SW', 3),
      name: 'SwiftLint configured (.swiftlint.yml)',
      category: 'swift',
      impact: 'medium',
      fix: 'Configure SwiftLint with `.swiftlint.yml` or equivalent build/CI integration for consistent Swift quality checks.',
      check: (ctx) => {
        if (!hasSwiftSurface(ctx)) return null;
        return hasMatchingFile(ctx, /(^|[\\/])\.swiftlint\.ya?ml$/i) ||
          /swiftlint/i.test(swiftConfigText(ctx) + '\n' + workflowText(ctx));
      },
    }),
    [makeKey('SwiftXCTestDocumented')]: makeCheck({
      platform,
      id: makeId('SW', 4),
      name: 'XCTest documented',
      category: 'swift',
      impact: 'high',
      fix: 'Document the XCTest or `xcodebuild test` workflow so iOS verification is part of the default path.',
      check: (ctx) => hasSwiftSurface(ctx)
        ? /xctest|swift test|xcodebuild[^\n\r]{0,200}\btest\b|test target/i.test(projectText(ctx, docs)) ||
          hasMatchingFile(ctx, /(^|[\\/])Tests([\\/]|$)|XCTestCase/i)
        : null,
    }),
    [makeKey('SwiftDependenciesManaged')]: makeCheck({
      platform,
      id: makeId('SW', 5),
      name: 'CocoaPods/SPM dependencies managed (Podfile or Package.swift)',
      category: 'swift',
      impact: 'high',
      fix: 'Use CocoaPods or Swift Package Manager with a committed `Podfile` or `Package.swift` for dependency management.',
      check: (ctx) => hasSwiftSurface(ctx)
        ? hasMatchingFile(ctx, /(^|[\\/])Podfile$/i) || hasMatchingFile(ctx, /(^|[\\/])Package\.swift$/i)
        : null,
    }),
    [makeKey('SwiftSchemeTargetDocumented')]: makeCheck({
      platform,
      id: makeId('SW', 6),
      name: 'Scheme/target documentation',
      category: 'swift',
      impact: 'medium',
      fix: 'Document Xcode schemes, targets, and the canonical build/test entry points for the repo.',
      check: (ctx) => hasSwiftSurface(ctx)
        ? /scheme|target|workspace|xcodebuild -scheme/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('SwiftSigningDocumented')]: makeCheck({
      platform,
      id: makeId('SW', 7),
      name: 'Signing configuration documented',
      category: 'swift',
      impact: 'high',
      fix: 'Document signing, provisioning profiles, certificates, and Team ID handling for iOS releases.',
      check: (ctx) => hasSwiftSurface(ctx)
        ? /signing|provisioning|certificate|team id|bundle identifier/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('SwiftUiApproachDocumented')]: makeCheck({
      platform,
      id: makeId('SW', 8),
      name: 'SwiftUI vs UIKit approach documented',
      category: 'swift',
      impact: 'medium',
      fix: 'Document whether the app uses SwiftUI, UIKit, or a hybrid approach so generated changes follow the right UI architecture.',
      check: (ctx) => {
        if (!hasSwiftSurface(ctx)) return null;
        const source = swiftUiSignals(ctx);
        if (!/SwiftUI|UIKit/i.test(source)) return null;
        return /swiftui|uikit|hybrid ui/i.test(projectText(ctx, docs));
      },
    }),
    [makeKey('SwiftDataPatternsDocumented')]: makeCheck({
      platform,
      id: makeId('SW', 9),
      name: 'Core Data/SwiftData patterns documented',
      category: 'swift',
      impact: 'medium',
      fix: 'Document Core Data or SwiftData usage patterns when the project persists data through Apple-native storage frameworks.',
      check: (ctx) => {
        if (!hasSwiftSurface(ctx)) return null;
        const source = swiftUiSignals(ctx) + '\n' + swiftConfigText(ctx);
        if (!/CoreData|SwiftData/i.test(source)) return null;
        return /core data|swiftdata|modelcontext|persistentcontainer/i.test(projectText(ctx, docs));
      },
    }),
    [makeKey('SwiftGitignore')]: makeCheck({
      platform,
      id: makeId('SW', 10),
      name: 'Xcode-specific .gitignore',
      category: 'swift',
      impact: 'medium',
      fix: 'Add Xcode ignore rules such as `DerivedData/`, `xcuserdata/`, and `.build/` to `.gitignore`.',
      check: (ctx) => {
        if (!hasSwiftSurface(ctx)) return null;
        const gitignore = fileContent(ctx, '.gitignore');
        return /DerivedData\/|xcuserdata\/|\.build\/|\*\.xcuserstate/i.test(gitignore);
      },
    }),

    [makeKey('KotlinBuildGradleExists')]: makeCheck({
      platform,
      id: makeId('KT', 1),
      name: 'build.gradle.kts exists',
      category: 'kotlin',
      impact: 'high',
      fix: 'Commit `build.gradle.kts` for the Android/Kotlin project so build logic is explicit and reviewable.',
      check: (ctx) => hasAndroidKotlinSurface(ctx) ? true : null,
    }),
    [makeKey('KotlinVersionSpecified')]: makeCheck({
      platform,
      id: makeId('KT', 2),
      name: 'Kotlin version specified',
      category: 'kotlin',
      impact: 'high',
      fix: 'Specify the Kotlin version in Gradle plugins, version catalogs, or build properties.',
      check: (ctx) => {
        if (!hasAndroidKotlinSurface(ctx)) return null;
        return /kotlin(?:\(["'][^)]+["']\))?\s+version\s+["'][^"']+["']|org\.jetbrains\.kotlin\.[\w.-]+\s+version\s+["'][^"']+["']|kotlin\s*=\s*["'][^"']+["']/i.test(androidGradleText(ctx));
      },
    }),
    [makeKey('KotlinLintConfigured')]: makeCheck({
      platform,
      id: makeId('KT', 3),
      name: 'ktlint/detekt configured',
      category: 'kotlin',
      impact: 'medium',
      fix: 'Configure ktlint or detekt in Gradle or CI so Kotlin style and static-analysis rules stay consistent.',
      check: (ctx) => {
        if (!hasAndroidKotlinSurface(ctx)) return null;
        return hasMatchingFile(ctx, /(^|[\\/])\.?detekt\.ya?ml$/i) ||
          /ktlint|detekt/i.test(androidGradleText(ctx) + '\n' + workflowText(ctx));
      },
    }),
    [makeKey('KotlinAndroidTestsDocumented')]: makeCheck({
      platform,
      id: makeId('KT', 4),
      name: 'Android test framework documented',
      category: 'kotlin',
      impact: 'high',
      fix: 'Document the Android test stack such as JUnit, Espresso, Robolectric, or `connectedAndroidTest` in repo guidance.',
      check: (ctx) => hasAndroidKotlinSurface(ctx)
        ? /androidtest|connectedandroidtest|espresso|robolectric|junit|gradlew test/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('KotlinGradleWrapperCommitted')]: makeCheck({
      platform,
      id: makeId('KT', 5),
      name: 'Gradle wrapper committed (gradlew)',
      category: 'kotlin',
      impact: 'high',
      fix: 'Commit `gradlew` and the Gradle wrapper files so Android builds are reproducible across environments.',
      check: (ctx) => hasAndroidKotlinSurface(ctx)
        ? hasMatchingFile(ctx, /(^|[\\/])gradlew(?:\.bat)?$/i)
        : null,
    }),
    [makeKey('KotlinBuildVariantsDocumented')]: makeCheck({
      platform,
      id: makeId('KT', 6),
      name: 'Build variants documented',
      category: 'kotlin',
      impact: 'medium',
      fix: 'Document Android build types and product flavors so agents know how to target debug, release, and environment variants.',
      check: (ctx) => hasAndroidKotlinSurface(ctx)
        ? /build variant|build type|productflavors|flavor|debug|release|staging/i.test(projectText(ctx, docs) + '\n' + androidGradleText(ctx))
        : null,
    }),
    [makeKey('KotlinProguardConfigured')]: makeCheck({
      platform,
      id: makeId('KT', 7),
      name: 'ProGuard/R8 configuration',
      category: 'kotlin',
      impact: 'medium',
      fix: 'Add ProGuard or R8 configuration such as `proguard-rules.pro` and minification settings for release builds.',
      check: (ctx) => {
        if (!hasAndroidKotlinSurface(ctx)) return null;
        return hasMatchingFile(ctx, /(^|[\\/])proguard-rules\.pro$/i) ||
          /proguardFiles|minifyEnabled|isMinifyEnabled|shrinkResources|r8/i.test(androidGradleText(ctx));
      },
    }),
    [makeKey('KotlinUiApproachDocumented')]: makeCheck({
      platform,
      id: makeId('KT', 8),
      name: 'Compose vs XML approach documented',
      category: 'kotlin',
      impact: 'medium',
      fix: 'Document whether the Android UI is Jetpack Compose, XML layouts, or hybrid so generated changes follow the right pattern.',
      check: (ctx) => {
        if (!hasAndroidKotlinSurface(ctx)) return null;
        const signals = kotlinComposeSignals(ctx);
        const hasCompose = /compose\s*=\s*true|@Composable|androidx\.compose/i.test(signals);
        const hasXml = hasMatchingFile(ctx, /(^|[\\/])src[\\/].+[\\/]res[\\/]layout[\\/].+\.xml$/i);
        if (!hasCompose && !hasXml) return null;
        return /compose|xml|jetpack compose|layout xml|viewbinding/i.test(projectText(ctx, docs));
      },
    }),
    [makeKey('KotlinSigningDocumented')]: makeCheck({
      platform,
      id: makeId('KT', 9),
      name: 'Signing config documented',
      category: 'kotlin',
      impact: 'high',
      fix: 'Document Android release signing, keystores, and environment variable expectations for mobile delivery.',
      check: (ctx) => hasAndroidKotlinSurface(ctx)
        ? /signingconfig|keystore|release signing|upload key|signing/i.test(projectText(ctx, docs))
        : null,
    }),
    [makeKey('KotlinGitignore')]: makeCheck({
      platform,
      id: makeId('KT', 10),
      name: 'Android-specific .gitignore',
      category: 'kotlin',
      impact: 'medium',
      fix: 'Add Android-specific ignore rules such as `.gradle/`, `local.properties`, and IDE build artifacts to `.gitignore`.',
      check: (ctx) => {
        if (!hasAndroidKotlinSurface(ctx)) return null;
        const gitignore = fileContent(ctx, '.gitignore');
        return /\.gradle\/|local\.properties|\*\.iml|captures\/|build_file_checksums\.ser/i.test(gitignore);
      },
    }),
  };
}

module.exports = {
  buildStackChecks,
};
