# Tests of the menu bar app without its platform layer, against the core's
# scripted transport, credential store and clock and a fake menu bar item
# and login item. They run on any platform with the offscreen Qt platform,
# and never reach a keychain, another host or the user's settings.

add_executable(menubarapptest menubarapptest.cpp)
target_link_libraries(menubarapptest PRIVATE tokklmacos tokklcorefakes Qt6::Test)
# The iconset and the outline the menu bar logos are compiled from, to
# compare them with.
target_compile_definitions(menubarapptest PRIVATE
    TOKKL_RESOURCES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../resources"
    TOKKL_ICONSET_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../resources/${TOKKL_BUNDLE_ICON}.iconset")
add_test(NAME menubarapp COMMAND menubarapptest)

set(_tests menubarapp)

# The Keychain store's mapping of QtKeychain errors; it reads no keychain.
if(TARGET tokklkeychain)
    add_executable(keychaincredentialstoretest keychaincredentialstoretest.cpp)
    target_link_libraries(keychaincredentialstoretest PRIVATE tokklkeychain Qt6::Test)
    add_test(NAME keychaincredentialstore COMMAND keychaincredentialstoretest)
    list(APPEND _tests keychaincredentialstore)
endif()

set(_unit_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-unit")
set_tests_properties(${_tests} PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;XDG_DATA_HOME=${_unit_xdg}/data;XDG_CONFIG_HOME=${_unit_xdg}/config;XDG_CACHE_HOME=${_unit_xdg}/cache;XDG_STATE_HOME=${_unit_xdg}/state")

# The bundle's Info.plist keeps the app out of the Dock and names the bundle.
add_test(NAME infoplist
    COMMAND ${CMAKE_COMMAND}
        -DINFO_PLIST=${TOKKL_INFO_PLIST}
        -DBUNDLE_ID=${TOKKL_BUNDLE_ID}
        -DVERSION=${TOKKL_RESOLVED_VERSION}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/infoplisttest.cmake)
