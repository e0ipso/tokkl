# Unit tests of the API client, connection state and timer controller,
# against the scripted transport, credential store and clock in fakes.h, and
# of the real transport against an in-process loopback server. They never
# reach a credential store, another host or real configuration; private XDG
# dirs make sure of the last.

# The fakes, for these tests and for companion tests that drive tokklcore.
# fakes.h declares QObject classes, so it is a source of every consumer for
# moc.
add_library(tokklcorefakes INTERFACE)
target_sources(tokklcorefakes INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/fakes.h)
target_include_directories(tokklcorefakes INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(tokklcorefakes INTERFACE tokklcore)

# tokkl_core_test(<name> <source> [<library>...]) builds <source> and
# registers it with CTest as <name>.
function(tokkl_core_test name source)
    get_filename_component(target "${source}" NAME_WE)
    add_executable(${target} ${source})
    target_link_libraries(${target} PRIVATE tokklcore Qt6::Test ${ARGN})
    add_test(NAME ${name} COMMAND ${target})
endfunction()

tokkl_core_test(api apitest.cpp)
tokkl_core_test(connection connectiontest.cpp tokklcorefakes)
tokkl_core_test(networktransport networktransporttest.cpp)
# The User-Agent check needs the version the transport sends.
target_compile_definitions(networktransporttest PRIVATE
    TOKKL_VERSION_STRING="${TOKKL_CORE_VERSION}")
tokkl_core_test(timer timercontrollertest.cpp tokklcorefakes)

set(_unit_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-unit")
set_tests_properties(api connection networktransport timer PROPERTIES
    ENVIRONMENT "XDG_DATA_HOME=${_unit_xdg}/data;XDG_CONFIG_HOME=${_unit_xdg}/config;XDG_CACHE_HOME=${_unit_xdg}/cache;XDG_STATE_HOME=${_unit_xdg}/state")
