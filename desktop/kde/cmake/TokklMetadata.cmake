# Works in script mode (cmake -P), so tests call it without a project.

# tokkl_stamp_metadata(INPUT <metadata.json> OUTPUT <metadata.json> VERSION <version>)
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
