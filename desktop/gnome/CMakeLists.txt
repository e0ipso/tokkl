# TOKKL_GNOME_DAEMON=OFF builds only the service library and its tests,
# without QtKeychain or libpulse.

cmake_minimum_required(VERSION 3.27...3.31)

set(TOKKL_QT_MIN_VERSION "6.8.0")

# Package builds point this at the copy next to their source tree.
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
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${TOKKL_PACKAGE_JSON}")
endif()

project(tokkl-gnome VERSION ${_tokkl_version_core} LANGUAGES CXX)

option(TOKKL_GNOME_DAEMON "Build tokkl-timerd and its QtKeychain credential store" ON)

include(CTest)
include(GNUInstallDirs)

set(CMAKE_AUTOMOC ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Same as desktop/core and the KDE build.
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

find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS Core Network DBus)
if(TOKKL_GNOME_DAEMON)
    find_package(Qt6Keychain REQUIRED)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(PulseSimple REQUIRED IMPORTED_TARGET libpulse-simple)
endif()

message(STATUS "Tokkl GNOME companion version: ${TOKKL_RESOLVED_VERSION}")

# Generates the adaptor; tests compare the live interface with it.
set(TOKKL_TIMER1_XML "${CMAKE_CURRENT_SOURCE_DIR}/dbus/org.tokkl.Timer1.xml")

add_subdirectory("${TOKKL_CORE_DIR}" core)
add_subdirectory(src)
if(TOKKL_GNOME_DAEMON)
    add_subdirectory(dbus)
endif()

if(BUILD_TESTING)
    find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS Test)
    add_subdirectory(autotests)
endif()
