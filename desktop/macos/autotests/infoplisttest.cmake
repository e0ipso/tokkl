# Checks the configured Info.plist: LSUIElement is true, so the app has no
# Dock icon, and the bundle id and version are the resolved ones. On macOS,
# plutil also checks that the file is a valid property list.
#
#   cmake -DINFO_PLIST=<file> -DBUNDLE_ID=<id> -DVERSION=<version> -P infoplisttest.cmake

foreach(_var INFO_PLIST BUNDLE_ID VERSION)
    if(NOT DEFINED ${_var} OR "${${_var}}" STREQUAL "")
        message(FATAL_ERROR "${_var} is not set")
    endif()
endforeach()

file(READ "${INFO_PLIST}" _plist)

function(expect_key key value_regex)
    string(REGEX MATCH "<key>${key}</key>[ \t\r\n]*${value_regex}" _found "${_plist}")
    if(NOT _found)
        message(FATAL_ERROR "${INFO_PLIST}: ${key} is not ${value_regex}")
    endif()
endfunction()

string(REPLACE "." "\\." _bundle_id_regex "${BUNDLE_ID}")
string(REPLACE "." "\\." _version_regex "${VERSION}")
string(REPLACE "+" "\\+" _version_regex "${_version_regex}")

expect_key(LSUIElement "<true/>")
expect_key(CFBundleIdentifier "<string>${_bundle_id_regex}</string>")
expect_key(CFBundleVersion "<string>${_version_regex}</string>")
expect_key(CFBundleExecutable "<string>Tokkl</string>")

if(_plist MATCHES "@[A-Za-z_]+@")
    message(FATAL_ERROR "${INFO_PLIST}: unreplaced placeholder ${CMAKE_MATCH_0}")
endif()

if(CMAKE_HOST_APPLE)
    execute_process(COMMAND plutil -lint "${INFO_PLIST}" RESULT_VARIABLE _lint)
    if(NOT _lint EQUAL 0)
        message(FATAL_ERROR "${INFO_PLIST}: plutil -lint failed")
    endif()
endif()

message(STATUS "${INFO_PLIST}: LSUIElement true, ${BUNDLE_ID} ${VERSION}")
