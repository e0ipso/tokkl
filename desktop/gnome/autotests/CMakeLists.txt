# Every bus test starts its own dbus-daemon (privatebus.h), so the user's
# session bus, keyring and services are never reached.

find_program(TOKKL_DBUS_DAEMON dbus-daemon REQUIRED)

set(_gnome_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-gnome")
set(_gnome_env
    "XDG_DATA_HOME=${_gnome_xdg}/data;XDG_CONFIG_HOME=${_gnome_xdg}/config;XDG_CACHE_HOME=${_gnome_xdg}/cache;XDG_STATE_HOME=${_gnome_xdg}/state")

list(JOIN TOKKL_POMODORO_SOUND_FILES "|" _sound_files)

add_executable(timerservicetest timerservicetest.cpp privatebus.h)
target_link_libraries(timerservicetest PRIVATE tokklgnome tokklcorefakes Qt6::DBus Qt6::Test)
target_compile_definitions(timerservicetest PRIVATE
    TOKKL_DBUS_DAEMON="${TOKKL_DBUS_DAEMON}"
    TOKKL_TIMER1_XML="${TOKKL_TIMER1_XML}"
    TOKKL_POMODORO_SOUND_FILES="${_sound_files}")
add_test(NAME timerservice COMMAND timerservicetest)

add_executable(servicesettingstest servicesettingstest.cpp)
target_link_libraries(servicesettingstest PRIVATE tokklgnome tokklcorefakes Qt6::Test)
add_test(NAME servicesettings COMMAND servicesettingstest)

add_executable(wavfiletest wavfiletest.cpp)
target_link_libraries(wavfiletest PRIVATE tokklgnome Qt6::Test)
target_compile_definitions(wavfiletest PRIVATE TOKKL_POMODORO_SOUND_FILES="${_sound_files}")
add_test(NAME wavfile COMMAND wavfiletest)

set_tests_properties(timerservice servicesettings wavfile PROPERTIES ENVIRONMENT "${_gnome_env}")

if(TOKKL_GNOME_DAEMON)
    # Runs a throwaway GNOME Keyring daemon on the private bus.
    find_program(TOKKL_GNOME_KEYRING_DAEMON gnome-keyring-daemon REQUIRED)
    find_program(TOKKL_SECRET_TOOL secret-tool REQUIRED)
    add_executable(keychainstoretest keychainstoretest.cpp privatebus.h)
    target_link_libraries(keychainstoretest PRIVATE tokklkeychain Qt6::DBus Qt6::Test)
    target_compile_definitions(keychainstoretest PRIVATE
        TOKKL_DBUS_DAEMON="${TOKKL_DBUS_DAEMON}"
        TOKKL_GNOME_KEYRING_DAEMON="${TOKKL_GNOME_KEYRING_DAEMON}"
        TOKKL_SECRET_TOOL="${TOKKL_SECRET_TOOL}")
    add_test(NAME keychainstore COMMAND keychainstoretest)

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

    # PULSE_SERVER points at a missing socket.
    add_executable(pulsebackendtest pulsebackendtest.cpp)
    target_link_libraries(pulsebackendtest PRIVATE tokklalarm Qt6::Test)
    target_compile_definitions(pulsebackendtest PRIVATE TOKKL_POMODORO_SOUND_FILES="${_sound_files}")
    add_test(NAME pulsebackend COMMAND pulsebackendtest)

    set_tests_properties(keychainstore activation pulsebackend PROPERTIES ENVIRONMENT "${_gnome_env}")
endif()
