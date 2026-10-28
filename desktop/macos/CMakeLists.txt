# Tokkl macOS companion: a menu bar app (Qt Widgets plus a small
# Objective-C++ layer for NSStatusItem and SMAppService) on the shared core
# in desktop/core. Standalone project; the npm workspaces and the server image
# do not build or ship anything from this directory.
#
# On macOS it builds Tokkl.app. Elsewhere it builds only the platform-neutral
# library and its tests, so the menu, settings and wiring can be tested on
# any machine with Qt 6.

cmake_minimum_required(VERSION 3.27...3.31)

set(TOKKL_QT_MIN_VERSION "6.10.0")
# SMAppService, which registers the login item, needs macOS 13.
set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0" CACHE STRING "Minimum macOS version")

# The identity that signs Tokkl.app after each build. "-" signs ad hoc.
set(TOKKL_CODESIGN_IDENTITY "-" CACHE STRING "codesign identity for Tokkl.app")

# The shared desktop core (tokklcore and its tests).
set(TOKKL_CORE_DIR "${CMAKE_CURRENT_LIST_DIR}/../core"
    CACHE PATH "Source directory of the Tokkl desktop core")

include(${TOKKL_CORE_DIR}/cmake/TokklVersion.cmake)

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

if(APPLE)
    project(tokkl-macos VERSION ${_tokkl_version_core} LANGUAGES CXX OBJCXX)
else()
    project(tokkl-macos VERSION ${_tokkl_version_core} LANGUAGES CXX)
endif()

include(CTest)

set(CMAKE_AUTOMOC ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The Qt rules desktop/core applies to itself.
add_compile_definitions(
    QT_NO_CAST_FROM_ASCII
    QT_NO_CAST_FROM_BYTEARRAY
    QT_NO_CAST_TO_ASCII
    QT_NO_FOREACH
    QT_NO_KEYWORDS
    QT_NO_NARROWING_CONVERSIONS_IN_CONNECT
    QT_NO_URL_CAST_FROM_STRING
    QT_STRICT_ITERATORS
    QT_USE_QSTRINGBUILDER
)

find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS Core Gui Network Widgets)

# Credentials go to the macOS Keychain through QtKeychain. Elsewhere the
# store is built and tested only when QtKeychain happens to be installed.
if(APPLE)
    find_package(Qt6Keychain REQUIRED)
else()
    find_package(Qt6Keychain QUIET)
endif()

message(STATUS "Tokkl macOS companion version: ${TOKKL_RESOLVED_VERSION}")

# The bundle's Info.plist. LSUIElement keeps the app out of the Dock and the
# app switcher; the menu bar item is its only presence. CFBundleIconFile names
# <TOKKL_BUNDLE_ICON>.icns, which the build makes from resources/.
set(TOKKL_BUNDLE_ID "com.canpicasoft.tokkl")
set(TOKKL_BUNDLE_NAME "Tokkl")
set(TOKKL_BUNDLE_ICON "Tokkl")
set(TOKKL_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist")
configure_file(cmake/Info.plist.in "${TOKKL_INFO_PLIST}" @ONLY)

add_subdirectory("${TOKKL_CORE_DIR}" core)
add_subdirectory(src)

if(BUILD_TESTING)
    find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS Test)
    add_subdirectory(autotests)
endif()
