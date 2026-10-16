# Tokkl desktop core: the API client, the credential store interface,
# connection state and the timer controller that the desktop companions
# share. It needs Qt Core and Network, plus Qt Test for its tests, and
# nothing from KDE. Build it on its own, or add it to a companion's project
# with add_subdirectory(); desktop/kde does.

cmake_minimum_required(VERSION 3.27...3.31)

set(TOKKL_CORE_QT_MIN_VERSION "6.10.0")

include(${CMAKE_CURRENT_LIST_DIR}/cmake/TokklVersion.cmake)

# Empty by default: the version comes from the root package.json. Release
# builds pass the resolved shared Tokkl version, for example -DTOKKL_VERSION=1.2.0.
# A companion that adds this directory has set both already.
set(TOKKL_VERSION "" CACHE STRING "Tokkl release version; empty reads the root package.json")
set(TOKKL_PACKAGE_JSON "${CMAKE_CURRENT_LIST_DIR}/../../package.json"
    CACHE FILEPATH "package.json that provides the default version")

tokkl_resolve_version(TOKKL_CORE_VERSION
    PACKAGE_JSON "${TOKKL_PACKAGE_JSON}"
    OVERRIDE "${TOKKL_VERSION}")
tokkl_version_core(_tokkl_core_version_core "${TOKKL_CORE_VERSION}")
if(TOKKL_VERSION STREQUAL "")
    # Re-run configure when the root version changes.
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${TOKKL_PACKAGE_JSON}")
endif()

project(tokkl-core VERSION ${_tokkl_core_version_core} LANGUAGES CXX)

if(PROJECT_IS_TOP_LEVEL)
    include(CTest)
endif()

set(CMAKE_AUTOMOC ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The Qt rules the KDE build applies, so a change that builds here also
# builds inside a companion.
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

find_package(Qt6 ${TOKKL_CORE_QT_MIN_VERSION} REQUIRED COMPONENTS Core Network)

message(STATUS "Tokkl desktop core version: ${TOKKL_CORE_VERSION}")

add_subdirectory(src)

if(BUILD_TESTING)
    find_package(Qt6 ${TOKKL_CORE_QT_MIN_VERSION} REQUIRED COMPONENTS Test)
    add_subdirectory(autotests)
endif()
