# The core unit tests (api, connection, networktransport and timer) come
# from desktop/core, added with it in the top-level CMakeLists.txt.
#
# Every test here starts its own dbus-daemon (privatebus.h) with no service
# files of the user's, so the user's session bus, keyring and services are
# never reached.
#
# timerservice drives org.tokkl.Timer1 over the private bus against the
# core's fake transport, credential store and clock. It needs no QtKeychain.

find_program(TOKKL_DBUS_DAEMON dbus-daemon REQUIRED)

set(_gnome_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-gnome")
set(_gnome_env
    "XDG_DATA_HOME=${_gnome_xdg}/data;XDG_CONFIG_HOME=${_gnome_xdg}/config;XDG_CACHE_HOME=${_gnome_xdg}/cache;XDG_STATE_HOME=${_gnome_xdg}/state")

add_executable(timerservicetest timerservicetest.cpp privatebus.h)
target_link_libraries(timerservicetest PRIVATE tokklgnome tokklcorefakes Qt6::DBus Qt6::Test)
target_compile_definitions(timerservicetest PRIVATE
    TOKKL_DBUS_DAEMON="${TOKKL_DBUS_DAEMON}"
    TOKKL_TIMER1_XML="${TOKKL_TIMER1_XML}")
add_test(NAME timerservice COMMAND timerservicetest)
set_tests_properties(timerservice PROPERTIES ENVIRONMENT "${_gnome_env}")

if(TOKKL_GNOME_DAEMON)
    # keychainstore runs the QtKeychain store against a GNOME Keyring daemon
    # the test starts on its private bus, unlocked with a throwaway password,
    # with its keyrings in a temporary directory, and checks the secret with
    # libsecret's secret-tool.
    find_program(TOKKL_GNOME_KEYRING_DAEMON gnome-keyring-daemon REQUIRED)
    find_program(TOKKL_SECRET_TOOL secret-tool REQUIRED)
    add_executable(keychainstoretest keychainstoretest.cpp privatebus.h)
    target_link_libraries(keychainstoretest PRIVATE tokklkeychain Qt6::DBus Qt6::Test)
    target_compile_definitions(keychainstoretest PRIVATE
        TOKKL_DBUS_DAEMON="${TOKKL_DBUS_DAEMON}"
        TOKKL_GNOME_KEYRING_DAEMON="${TOKKL_GNOME_KEYRING_DAEMON}"
        TOKKL_SECRET_TOOL="${TOKKL_SECRET_TOOL}")
    add_test(NAME keychainstore COMMAND keychainstoretest)

    # activation lets a private bus start the built tokkl-timerd from the
    # activation file the project installs, pointed at the build tree.
    set(_activation_dir "${CMAKE_CURRENT_BINARY_DIR}/activation")
    set(TOKKL_TIMERD_EXEC "$<TARGET_FILE:tokkl-timerd>")
    configure_file("${PROJECT_SOURCE_DIR}/dbus/org.tokkl.Timer1.service.in"
        "${CMAKE_CURRENT_BINARY_DIR}/org.tokkl.Timer1.service.genex" @ONLY)
    file(GENERATE OUTPUT "${_activation_dir}/org.tokkl.Timer1.service"
        INPUT "${CMAKE_CURRENT_BINARY_DIR}/org.tokkl.Timer1.service.genex")
    add_executable(activationtest activationtest.cpp privatebus.h)
    target_link_libraries(activationtest PRIVATE Qt6::DBus Qt6::Test)
    target_compile_definitions(activationtest PRIVATE
        TOKKL_DBUS_DAEMON="${TOKKL_DBUS_DAEMON}"
        TOKKL_ACTIVATION_DIR="${_activation_dir}"
        TOKKL_TIMERD="$<TARGET_FILE:tokkl-timerd>")
    add_dependencies(activationtest tokkl-timerd)
    add_test(NAME activation COMMAND activationtest)

    set_tests_properties(keychainstore activation PROPERTIES ENVIRONMENT "${_gnome_env}")
endif()
