# Builds Tokkl.app on macOS; elsewhere only the platform-neutral library
# and its tests.

cmake_minimum_required(VERSION 3.27...3.31)

set(TOKKL_QT_MIN_VERSION "6.10.0")
# SMAppService needs macOS 13.
set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0" CACHE STRING "Minimum macOS version")

# "-" signs ad hoc.
set(TOKKL_CODESIGN_IDENTITY "-" CACHE STRING "codesign identity for Tokkl.app")

set(TOKKL_CORE_DIR "${CMAKE_CURRENT_LIST_DIR}/../core"
    CACHE PATH "Source directory of the Tokkl desktop core")

include(${TOKKL_CORE_DIR}/cmake/TokklVersion.cmake)

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

# Elsewhere the store is built and tested only when QtKeychain is installed.
if(APPLE)
    find_package(Qt6Keychain REQUIRED)
else()
    find_package(Qt6Keychain QUIET)
endif()

message(STATUS "Tokkl macOS companion version: ${TOKKL_RESOLVED_VERSION}")

# LSUIElement keeps the app out of the Dock and the app switcher.
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
