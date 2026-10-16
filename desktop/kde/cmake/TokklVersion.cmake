# Version resolution and metadata stamping for the KDE companion.
#
# The companion ships with the Tokkl release it belongs to, so it has no
# version of its own: the default comes from the root package.json and a
# release build passes the resolved shared version explicitly.
#
# Works in project mode and in script mode (cmake -P), so the tests can call
# these functions without configuring a project.

# Same shape semantic-release produces: MAJOR.MINOR.PATCH with optional
# pre-release and build parts.
set(TOKKL_SEMVER_REGEX
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$")

# tokkl_resolve_version(<out-var> PACKAGE_JSON <path> [OVERRIDE <version>])
#
# Sets <out-var> to OVERRIDE when it is non-empty, otherwise to the "version"
# field of PACKAGE_JSON. Fails on a missing file, a missing field or a value
# that is not a semantic version.
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

# tokkl_version_core(<out-var> <version>)
#
# Sets <out-var> to MAJOR.MINOR.PATCH, the part CMake's project(VERSION) accepts.
function(tokkl_version_core out_var version)
    if(NOT version MATCHES "${TOKKL_SEMVER_REGEX}")
        message(FATAL_ERROR "\"${version}\" is not a semantic version.")
    endif()
    set(${out_var} "${CMAKE_MATCH_1}.${CMAKE_MATCH_2}.${CMAKE_MATCH_3}" PARENT_SCOPE)
endfunction()

# tokkl_stamp_metadata(INPUT <metadata.json> OUTPUT <metadata.json> VERSION <version>)
#
# Copies the widget metadata with KPlugin.Version set to VERSION. The source
# metadata carries no version, so there is nothing to keep in sync by hand.
function(tokkl_stamp_metadata)
    cmake_parse_arguments(PARSE_ARGV 0 ARG "" "INPUT;OUTPUT;VERSION" "")

    file(READ "${ARG_INPUT}" metadata)
    string(JSON existing ERROR_VARIABLE missing GET "${metadata}" KPlugin Version)
    if(NOT missing)
        message(FATAL_ERROR
            "${ARG_INPUT} sets KPlugin.Version to \"${existing}\". Remove it: "
            "the build stamps the Tokkl version.")
    endif()
    string(JSON metadata SET "${metadata}" KPlugin Version "\"${ARG_VERSION}\"")
    string(APPEND metadata "\n")

    # Rewrite only on change so a reconfigure does not reinstall the package.
    if(EXISTS "${ARG_OUTPUT}")
        file(READ "${ARG_OUTPUT}" current)
        if(current STREQUAL metadata)
            return()
        endif()
    endif()
    file(WRITE "${ARG_OUTPUT}" "${metadata}")
endfunction()
