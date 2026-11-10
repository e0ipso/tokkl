cmake_minimum_required(VERSION 3.27...3.31)

# The oldest supported stack, Debian 13: Qt 6.8.2, KF 6.13.0, Plasma 6.3.5.
set(TOKKL_QT_MIN_VERSION "6.8.0")
set(TOKKL_KF_MIN_VERSION "6.13.0")
set(TOKKL_PLASMA_MIN_VERSION "6.3.0")

# Package builds point this at the copy next to their source tree.
set(TOKKL_CORE_DIR "${CMAKE_CURRENT_LIST_DIR}/../core"
    CACHE PATH "Source directory of the Tokkl desktop core")

include(${TOKKL_CORE_DIR}/cmake/TokklVersion.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/cmake/TokklMetadata.cmake)

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

project(tokkl-kde VERSION ${_tokkl_version_core} LANGUAGES CXX)

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
include(ECMPoQmTools)
include(FeatureSummary)

find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS Core Gui Multimedia Network Qml Quick)
# libplasma's CMake package does not pull in KF6Config, which its link
# interface names.
find_package(KF6 ${TOKKL_KF_MIN_VERSION} REQUIRED COMPONENTS Wallet Package Config)
find_package(Plasma ${TOKKL_PLASMA_MIN_VERSION} REQUIRED)

ecm_find_qmlmodule(org.kde.plasma.plasmoid)
ecm_find_qmlmodule(org.kde.plasma.components)
ecm_find_qmlmodule(org.kde.plasma.configuration)
ecm_find_qmlmodule(org.kde.kirigami)
ecm_find_qmlmodule(org.kde.kcmutils)

message(STATUS "Tokkl KDE companion version: ${TOKKL_RESOLVED_VERSION}")

add_subdirectory("${TOKKL_CORE_DIR}" core)
add_subdirectory(src)
add_subdirectory(package)
# KDE's translation tooling puts Qt catalogs in poqm/<lang>/tokklcore_qt.po.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/poqm")
    ecm_install_po_files_as_qm(poqm)
endif()

if(BUILD_TESTING)
    find_package(Qt6 ${TOKKL_QT_MIN_VERSION} REQUIRED COMPONENTS DBus Test QuickTest)
    # find_package(Plasma) does not bring in KirigamiPlatform on Plasma 6.3.
    find_package(KF6 ${TOKKL_KF_MIN_VERSION} REQUIRED COMPONENTS I18n KirigamiPlatform)
    find_package(PlasmaQuick ${TOKKL_PLASMA_MIN_VERSION} REQUIRED)
    add_subdirectory(autotests)
    add_subdirectory(tests)
endif()

feature_summary(WHAT ALL INCLUDE_QUIET_PACKAGES FATAL_ON_MISSING_REQUIRED_PACKAGES)
