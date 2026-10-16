# Tokkl KDE companion: a Plasma 6 panel widget (QML package) and the Qt/C++
# QML module it imports. Standalone project; the npm workspaces and the server
# image do not build or ship anything from this directory.

cmake_minimum_required(VERSION 3.27...3.31)

# Minimum versions. They match the oldest supported target stack:
#   TUXEDO OS 24.04: Qt 6.10.2, KDE Frameworks 6.24.0, Plasma 6.6.6
#   Fedora KDE 44:   Qt 6.11.2, KDE Frameworks 6.25.0, Plasma 6.6.4 (libplasma)
# Older Plasma 6 releases are not supported.
set(TOKKL_QT_MIN_VERSION "6.10.0")
set(TOKKL_KF_MIN_VERSION "6.24.0")
set(TOKKL_PLASMA_MIN_VERSION "6.6.0")

include(${CMAKE_CURRENT_LIST_DIR}/cmake/TokklVersion.cmake)

# Empty by default: the version comes from the root package.json. Release
# builds pass the resolved shared Tokkl version, for example -DTOKKL_VERSION=1.2.0.
set(TOKKL_VERSION "" CACHE STRING "Tokkl release version; empty reads the root package.json")
set(TOKKL_PACKAGE_JSON "${CMAKE_CURRENT_LIST_DIR}/../../package.json"
    CACHE FILEPATH "package.json that provides the default version")

tokkl_resolve_version(TOKKL_RESOLVED_VERSION
    PACKAGE_JSON "${TOKKL_PACKAGE_JSON}"
    OVERRIDE "${TOKKL_VERSION}")
tokkl_version_core(_tokkl_version_core "${TOKKL_RESOLVED_VERSION}")
if(TOKKL_VERSION STREQUAL "")
    # Re-run configure when the root version changes.
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${TOKKL_PACKAGE_JSON}")
endif()

project(tokkl-kde VERSION ${_tokkl_version_core} LANGUAGES CXX)

# The widget's plugin id comes from its metadata; the backend's QML module
# URI extends it.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/package/metadata.json" _tokkl_metadata)
string(JSON TOKKL_PLASMOID_ID GET "${_tokkl_metadata}" KPlugin Id)
set(TOKKL_BACKEND_URI "${TOKKL_PLASMOID_ID}.backend")

find_package(ECM ${TOKKL_KF_MIN_VERSION} REQUIRED NO_MODULE)
set(CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)
include(ECMQmlModule)
include(ECMFindQmlModule)
include(FeatureSummary)

find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS Core Network Qml Quick)
find_package(KF6 ${TOKKL_KF_MIN_VERSION} REQUIRED COMPONENTS Wallet Package)
find_package(Plasma ${TOKKL_PLASMA_MIN_VERSION} REQUIRED)

# QML modules the widget and its Configure page import at runtime.
ecm_find_qmlmodule(org.kde.plasma.plasmoid)
ecm_find_qmlmodule(org.kde.plasma.components)
ecm_find_qmlmodule(org.kde.plasma.configuration)
ecm_find_qmlmodule(org.kde.kirigami)
ecm_find_qmlmodule(org.kde.kcmutils)

message(STATUS "Tokkl KDE companion version: ${TOKKL_RESOLVED_VERSION}")

add_subdirectory(src)
add_subdirectory(package)

if(BUILD_TESTING)
    find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS Test QuickTest)
    # The smoke test loads the widget through libplasma, whose CMake package
    # does not pull in KF6Config itself, and translates the Configure page
    # with KI18n as Plasma does.
    find_package(KF6 ${TOKKL_KF_MIN_VERSION} REQUIRED COMPONENTS Config I18n)
    find_package(PlasmaQuick ${TOKKL_PLASMA_MIN_VERSION} REQUIRED)
    add_subdirectory(autotests)
endif()

feature_summary(WHAT ALL INCLUDE_QUIET_PACKAGES FATAL_ON_MISSING_REQUIRED_PACKAGES)
