# The tests never reach a credential store or another host; private XDG dirs
# keep real configuration out.

# fakes.h declares QObject classes, so it is a source of every consumer for moc.
add_library(tokklcorefakes INTERFACE)
target_sources(tokklcorefakes INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/fakes.h)
target_include_directories(tokklcorefakes INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(tokklcorefakes INTERFACE tokklcore)

function(tokkl_core_test name source)
    get_filename_component(target "${source}" NAME_WE)
    add_executable(${target} ${source})
    target_link_libraries(${target} PRIVATE tokklcore Qt6::Test ${ARGN})
    add_test(NAME ${name} COMMAND ${target})
endfunction()

tokkl_core_test(api apitest.cpp)
tokkl_core_test(apiclient apiclienttest.cpp tokklcorefakes)
tokkl_core_test(connection connectiontest.cpp tokklcorefakes)
# The GNOME extension's tests read this file too.
target_compile_definitions(connectiontest PRIVATE
    TOKKL_INSECURE_URLS="${CMAKE_CURRENT_SOURCE_DIR}/insecureurls.json")
tokkl_core_test(cooldown cooldowntest.cpp)
tokkl_core_test(sessioncredentials sessioncredentialstest.cpp tokklcorefakes)
tokkl_core_test(networktransport networktransporttest.cpp)
# The User-Agent check needs the version the transport sends.
target_compile_definitions(networktransporttest PRIVATE
    TOKKL_VERSION_STRING="${TOKKL_CORE_VERSION}")
tokkl_core_test(timer timercontrollertest.cpp tokklcorefakes)
tokkl_core_test(timerparts timerpartstest.cpp)
tokkl_core_test(timerstateclient timerstateclienttest.cpp tokklcorefakes)
tokkl_core_test(timerstack timerstacktest.cpp tokklcorefakes)
tokkl_core_test(pomodorostore pomodorostoretest.cpp)
tokkl_core_test(translations translationstest.cpp)
tokkl_core_test(pomodoropreferences pomodoropreferencestest.cpp tokklcorefakes)
tokkl_core_test(pomodorosession pomodorosessiontest.cpp tokklcorefakes)
tokkl_core_test(pomodorosounds pomodorosoundstest.cpp)
cmake_path(SET _sounds_readme NORMALIZE "${CMAKE_CURRENT_SOURCE_DIR}/../../../docs/sounds/README.md")
list(JOIN TOKKL_POMODORO_SOUND_FILES "|" _sound_files)
target_compile_definitions(pomodorosoundstest PRIVATE
    TOKKL_SOUNDS_README="${_sounds_readme}"
    TOKKL_POMODORO_SOUND_FILES="${_sound_files}")
tokkl_core_test(statuspresentation statuspresentationtest.cpp)
# The GNOME extension's tests read this file too.
target_compile_definitions(statuspresentationtest PRIVATE
    TOKKL_STATUS_FIXTURE="${CMAKE_CURRENT_SOURCE_DIR}/statuspresentation.json")
tokkl_core_test(hourglassglyph hourglassglyphtest.cpp)
cmake_path(GET PROJECT_SOURCE_DIR PARENT_PATH _desktop_dir)
target_compile_definitions(hourglassglyphtest PRIVATE
    TOKKL_DESKTOP_DIR="${_desktop_dir}")

set(_unit_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-unit")
set_tests_properties(api apiclient connection sessioncredentials networktransport timer timerstateclient timerstack pomodorostore pomodoropreferences pomodorosession PROPERTIES
    ENVIRONMENT "XDG_DATA_HOME=${_unit_xdg}/data;XDG_CONFIG_HOME=${_unit_xdg}/config;XDG_CACHE_HOME=${_unit_xdg}/cache;XDG_STATE_HOME=${_unit_xdg}/state")
