# Metadata stamping for the KDE companion. The version it stamps comes from
# tokkl_resolve_version() in desktop/core/cmake/TokklVersion.cmake.
#
# Works in project mode and in script mode (cmake -P), so the tests can call
# it without configuring a project.

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
