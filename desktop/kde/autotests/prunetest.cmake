# Checks that a source file removed from package/contents/ disappears from the
# assembled package and from the staged install, with no clean build.
# Usage: cmake -DTOKKL_SOURCE_DIR=<desktop/kde> -DWORK_DIR=<dir>
#              [-DECM_DIR=<dir>] [-DPlasma_DIR=<dir>] -P prunetest.cmake
cmake_minimum_required(VERSION 3.27...3.31)

file(REMOVE_RECURSE "${WORK_DIR}")
file(MAKE_DIRECTORY "${WORK_DIR}")
set(src "${WORK_DIR}/src")
set(bld "${WORK_DIR}/build")

# A fixture project around a copy of the real package, so the test can delete
# files without touching the checkout.
file(COPY "${TOKKL_SOURCE_DIR}/package" "${TOKKL_SOURCE_DIR}/cmake" DESTINATION "${src}")
file(WRITE "${src}/package/contents/ui/Extra.qml" "import QtQuick\nItem {}\n")
file(WRITE "${src}/CMakeLists.txt" [=[
cmake_minimum_required(VERSION 3.27...3.31)
include(${CMAKE_CURRENT_LIST_DIR}/cmake/TokklMetadata.cmake)
project(prune-fixture LANGUAGES CXX)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/package/metadata.json" _metadata)
string(JSON TOKKL_PLASMOID_ID GET "${_metadata}" KPlugin Id)
set(TOKKL_RESOLVED_VERSION "1.0.0")
find_package(ECM REQUIRED NO_MODULE)
set(CMAKE_MODULE_PATH ${ECM_MODULE_PATH})
include(KDEInstallDirs)
find_package(Plasma REQUIRED)
add_subdirectory(package)
]=])

# Runs a command and fails the test, with its output, when it fails.
function(run what)
    execute_process(COMMAND ${ARGN}
        RESULT_VARIABLE result OUTPUT_VARIABLE out ERROR_VARIABLE out)
    if(NOT result EQUAL 0)
        message(FATAL_ERROR "${what} failed (${result}):\n${out}")
    endif()
endfunction()

# Installs into a fresh staging directory and returns any Extra.qml it holds.
function(stage_install name out_var)
    set(stage "${WORK_DIR}/${name}")
    file(REMOVE_RECURSE "${stage}")
    run("staged install ${name}"
        ${CMAKE_COMMAND} -E env DESTDIR=${stage} ${CMAKE_COMMAND} --install "${bld}")
    file(GLOB_RECURSE found "${stage}/Extra.qml")
    set(${out_var} "${found}" PARENT_SCOPE)
endfunction()

set(configure_args -S "${src}" -B "${bld}" -DCMAKE_INSTALL_PREFIX=/usr)
foreach(var ECM_DIR Plasma_DIR CMAKE_PREFIX_PATH)
    if(DEFINED ${var} AND NOT "${${var}}" STREQUAL "")
        list(APPEND configure_args "-D${var}=${${var}}")
    endif()
endforeach()
run("configure" ${CMAKE_COMMAND} ${configure_args})
run("build" ${CMAKE_COMMAND} --build "${bld}")

stage_install(stage-with found)
if(NOT found)
    message(FATAL_ERROR "fixture check: Extra.qml missing from the staged install before removal")
endif()

# Delete the source file and rebuild in the same build directory.
file(REMOVE "${src}/package/contents/ui/Extra.qml")
run("rebuild" ${CMAKE_COMMAND} --build "${bld}")

file(GLOB_RECURSE assembled "${bld}/package/Extra.qml")
if(assembled)
    message(FATAL_ERROR "removed source file is still in the assembled package: ${assembled}")
endif()
stage_install(stage-without found)
if(found)
    message(FATAL_ERROR "removed source file is still in the staged install: ${found}")
endif()

file(REMOVE_RECURSE "${WORK_DIR}")
message(STATUS "prune tests passed")
