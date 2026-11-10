# Works in script mode (cmake -P) too, so tests call these without a project.

# The shape semantic-release produces: MAJOR.MINOR.PATCH[-pre][+build].
set(TOKKL_SEMVER_REGEX
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$")

# tokkl_resolve_version(<out-var> PACKAGE_JSON <path> [OVERRIDE <version>])
# OVERRIDE when non-empty, else the package.json version; fails unless semver.
function(tokkl_resolve_version out_var)
    cmake_parse_arguments(PARSE_ARGV 1 ARG "" "PACKAGE_JSON;OVERRIDE" "")

    if(NOT "${ARG_OVERRIDE}" STREQUAL "")
        set(version "${ARG_OVERRIDE}")
        set(origin "the explicit TOKKL_VERSION")
    else()
        if(NOT EXISTS "${ARG_PACKAGE_JSON}")
            message(FATAL_ERROR
                "Cannot read the Tokkl version: ${ARG_PACKAGE_JSON} does not exist. "
                "Pass -DTOKKL_VERSION=<version> when building outside the Tokkl checkout.")
        endif()
        file(READ "${ARG_PACKAGE_JSON}" package_json)
        string(JSON version ERROR_VARIABLE json_error GET "${package_json}" version)
        if(json_error)
            message(FATAL_ERROR "Cannot read \"version\" from ${ARG_PACKAGE_JSON}: ${json_error}")
        endif()
        set(origin "${ARG_PACKAGE_JSON}")
    endif()

    if(NOT version MATCHES "${TOKKL_SEMVER_REGEX}")
        message(FATAL_ERROR "\"${version}\" from ${origin} is not a semantic version (MAJOR.MINOR.PATCH).")
    endif()

    set(${out_var} "${version}" PARENT_SCOPE)
endfunction()

# tokkl_version_core(<out-var> <version>): MAJOR.MINOR.PATCH for project(VERSION).
function(tokkl_version_core out_var version)
    if(NOT version MATCHES "${TOKKL_SEMVER_REGEX}")
        message(FATAL_ERROR "\"${version}\" is not a semantic version.")
    endif()
    set(${out_var} "${CMAKE_MATCH_1}.${CMAKE_MATCH_2}.${CMAKE_MATCH_3}" PARENT_SCOPE)
endfunction()
