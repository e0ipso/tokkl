add_executable(menubarapptest menubarapptest.cpp)
target_link_libraries(menubarapptest PRIVATE tokklmacos tokklcorefakes Qt6::Test)
target_compile_definitions(menubarapptest PRIVATE
    TOKKL_RESOURCES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../resources"
    TOKKL_ICONSET_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../resources/${TOKKL_BUNDLE_ICON}.iconset"
    TOKKL_SOUNDS_DIR="${TOKKL_CORE_DIR}/sounds"
    TOKKL_STATUS_FIXTURE="${TOKKL_CORE_DIR}/autotests/statuspresentation.json")
add_test(NAME menubarapp COMMAND menubarapptest)

set(_tests menubarapp)

if(TARGET tokklkeychain)
    add_executable(keychaincredentialstoretest keychaincredentialstoretest.cpp)
    target_link_libraries(keychaincredentialstoretest PRIVATE tokklkeychain Qt6::Test)
    add_test(NAME keychaincredentialstore COMMAND keychaincredentialstoretest)
    list(APPEND _tests keychaincredentialstore)
endif()

set(_unit_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-unit")
set_tests_properties(${_tests} PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;XDG_DATA_HOME=${_unit_xdg}/data;XDG_CONFIG_HOME=${_unit_xdg}/config;XDG_CACHE_HOME=${_unit_xdg}/cache;XDG_STATE_HOME=${_unit_xdg}/state")

add_test(NAME infoplist
    COMMAND ${CMAKE_COMMAND}
        -DINFO_PLIST=${TOKKL_INFO_PLIST}
        -DBUNDLE_ID=${TOKKL_BUNDLE_ID}
        -DVERSION=${TOKKL_RESOLVED_VERSION}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/infoplisttest.cmake)
