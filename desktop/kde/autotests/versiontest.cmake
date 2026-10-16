# Usage: cmake -DTOKKL_SOURCE_DIR=<desktop/kde> -DTOKKL_CORE_DIR=<desktop/core>
#              -DWORK_DIR=<dir> -P versiontest.cmake
cmake_minimum_required(VERSION 3.27...3.31)
include(${TOKKL_CORE_DIR}/cmake/TokklVersion.cmake)
include(${TOKKL_SOURCE_DIR}/cmake/TokklMetadata.cmake)

file(REMOVE_RECURSE "${WORK_DIR}")
file(MAKE_DIRECTORY "${WORK_DIR}")

function(expect_equal actual expected what)
    if(NOT actual STREQUAL expected)
        message(FATAL_ERROR "${what}: expected \"${expected}\", got \"${actual}\"")
    endif()
endfunction()

# Runs a snippet in a child cmake and expects it to fail with a message
# matching <pattern>.
function(expect_failure pattern what snippet)
    set(script "${WORK_DIR}/failure.cmake")
    file(WRITE "${script}"
        "cmake_minimum_required(VERSION 3.27...3.31)\n"
        "include(\"${TOKKL_CORE_DIR}/cmake/TokklVersion.cmake\")\n"
        "include(\"${TOKKL_SOURCE_DIR}/cmake/TokklMetadata.cmake\")\n"
        "${snippet}\n")
    execute_process(COMMAND ${CMAKE_COMMAND} -P "${script}"
        RESULT_VARIABLE result ERROR_VARIABLE stderr OUTPUT_QUIET)
    if(result EQUAL 0)
        message(FATAL_ERROR "${what}: expected a failure, but it succeeded")
    endif()
    string(REGEX REPLACE "[ \n]+" " " stderr "${stderr}")
    if(NOT stderr MATCHES "${pattern}")
        message(FATAL_ERROR "${what}: failure did not match \"${pattern}\":\n${stderr}")
    endif()
endfunction()

set(package_json "${WORK_DIR}/package.json")
file(WRITE "${package_json}" "{ \"name\": \"tokkl\", \"version\": \"3.4.5\" }\n")

# The default comes from package.json.
tokkl_resolve_version(version PACKAGE_JSON "${package_json}")
expect_equal("${version}" "3.4.5" "default version")
tokkl_resolve_version(version PACKAGE_JSON "${package_json}" OVERRIDE "")
expect_equal("${version}" "3.4.5" "empty override")

# An explicit release version wins, pre-releases included.
tokkl_resolve_version(version PACKAGE_JSON "${package_json}" OVERRIDE "4.0.0")
expect_equal("${version}" "4.0.0" "explicit version")
tokkl_resolve_version(version PACKAGE_JSON "${WORK_DIR}/missing.json" OVERRIDE "4.1.0-rc.1+build.7")
expect_equal("${version}" "4.1.0-rc.1+build.7" "explicit version without package.json")
tokkl_version_core(core "4.1.0-rc.1+build.7")
expect_equal("${core}" "4.1.0" "version core")

# The real root package.json resolves. A standalone copy of this directory,
# built with -DTOKKL_VERSION, has no repository root to check.
set(root_package_json "${TOKKL_SOURCE_DIR}/../../package.json")
if(EXISTS "${root_package_json}")
    tokkl_resolve_version(version PACKAGE_JSON "${root_package_json}")
    if(NOT version MATCHES "${TOKKL_SEMVER_REGEX}")
        message(FATAL_ERROR "root package.json version \"${version}\" is not a semantic version")
    endif()
else()
    message(STATUS "No root package.json; skipping the repository version check")
endif()

expect_failure("is not a semantic version" "malformed override"
    "tokkl_resolve_version(v PACKAGE_JSON \"${package_json}\" OVERRIDE \"v1.2\")")
expect_failure("missing.json does not exist" "missing package.json"
    "tokkl_resolve_version(v PACKAGE_JSON \"${WORK_DIR}/missing.json\")")
file(WRITE "${WORK_DIR}/noversion.json" "{ \"name\": \"tokkl\" }\n")
expect_failure("Cannot read \"version\"" "package.json without a version"
    "tokkl_resolve_version(v PACKAGE_JSON \"${WORK_DIR}/noversion.json\")")

# Stamping sets KPlugin.Version and keeps the rest.
tokkl_stamp_metadata(
    INPUT "${TOKKL_SOURCE_DIR}/package/metadata.json"
    OUTPUT "${WORK_DIR}/stamped/metadata.json"
    VERSION "4.1.0-rc.1")
file(READ "${TOKKL_SOURCE_DIR}/package/metadata.json" source)
file(READ "${WORK_DIR}/stamped/metadata.json" stamped)
string(JSON stamped_version GET "${stamped}" KPlugin Version)
expect_equal("${stamped_version}" "4.1.0-rc.1" "stamped version")
string(JSON source_id GET "${source}" KPlugin Id)
string(JSON stamped_id GET "${stamped}" KPlugin Id)
expect_equal("${stamped_id}" "${source_id}" "stamped plugin id")

# The source metadata must not carry its own version.
expect_failure("sets KPlugin.Version" "versioned source metadata"
    "tokkl_stamp_metadata(INPUT \"${WORK_DIR}/stamped/metadata.json\" OUTPUT \"${WORK_DIR}/again.json\" VERSION 1.0.0)")

message(STATUS "version tests passed")
