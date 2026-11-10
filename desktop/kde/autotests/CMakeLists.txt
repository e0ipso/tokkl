include(ECMAddTests)

# KDE Wallet reads Enabled from kwalletrc once per process, so the
# disabled wallet has its own test.
find_program(TOKKL_DBUS_DAEMON dbus-daemon REQUIRED)
find_program(TOKKL_DBUS_RUN_SESSION dbus-run-session REQUIRED)
find_program(TOKKL_DBUS_SEND dbus-send REQUIRED)
add_test(NAME smoke-session
    COMMAND ${CMAKE_COMMAND}
        -DDBUS_RUN_SESSION=${TOKKL_DBUS_RUN_SESSION}
        -DDBUS_SEND=${TOKKL_DBUS_SEND}
        -DSESSION_CONFIG=${PROJECT_SOURCE_DIR}/scripts/smoke-session.conf
        -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/smoke-session
        -P ${CMAKE_CURRENT_SOURCE_DIR}/smokesessiontest.cmake)
ecm_add_test(kdeconnectiontest.cpp
    TEST_NAME kdeconnection
    LINK_LIBRARIES tokklkde tokklcorefakes Qt6::DBus Qt6::Test)
target_compile_definitions(kdeconnection PRIVATE
    TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
    TOKKL_DBUS_DAEMON="${TOKKL_DBUS_DAEMON}")
ecm_add_test(kdewalletdisabledtest.cpp
    TEST_NAME kdewallet-disabled
    LINK_LIBRARIES tokklkde Qt6::Test)
set(_kde_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-kde")
set_tests_properties(kdeconnection kdewallet-disabled PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;XDG_DATA_HOME=${_kde_xdg}/data;XDG_CONFIG_HOME=${_kde_xdg}/config;XDG_CACHE_HOME=${_kde_xdg}/cache;XDG_STATE_HOME=${_kde_xdg}/state")

set(_pomodoro_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-pomodoro")
ecm_add_test(appletpomodorostoretest.cpp
    TEST_NAME appletpomodorostore
    LINK_LIBRARIES tokklkde Plasma::Plasma KF6::ConfigCore Qt6::Test)
set_tests_properties(appletpomodorostore PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;XDG_DATA_HOME=${_pomodoro_xdg}/data;XDG_CONFIG_HOME=${_pomodoro_xdg}/config;XDG_CACHE_HOME=${_pomodoro_xdg}/cache;XDG_STATE_HOME=${_pomodoro_xdg}/state")

set(_timerstate_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-timerstate")
ecm_add_test(kdetimerstatetest.cpp
    TEST_NAME kdetimerstate
    LINK_LIBRARIES tokklkde Plasma::Plasma KF6::ConfigCore Qt6::Test)
set_tests_properties(kdetimerstate PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;XDG_DATA_HOME=${_timerstate_xdg}/data;XDG_CONFIG_HOME=${_timerstate_xdg}/config;XDG_CACHE_HOME=${_timerstate_xdg}/cache;XDG_STATE_HOME=${_timerstate_xdg}/state")

set(_alarm_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-alarm")
ecm_add_test(alarmplayertest.cpp
    TEST_NAME alarmplayer
    LINK_LIBRARIES tokklkde Qt6::Test)
list(JOIN TOKKL_POMODORO_SOUND_FILES "|" _sound_files)
target_compile_definitions(alarmplayer PRIVATE
    TOKKL_PLASMOID_ID="${TOKKL_PLASMOID_ID}"
    TOKKL_POMODORO_SOUND_FILES="${_sound_files}")
set_tests_properties(alarmplayer PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;XDG_DATA_HOME=${_alarm_xdg}/data;XDG_CONFIG_HOME=${_alarm_xdg}/config;XDG_CACHE_HOME=${_alarm_xdg}/cache;XDG_STATE_HOME=${_alarm_xdg}/state")

# Kept out of bin/, where the build-tree backend module lives.
# KirigamiPlatform lets the fixture set Kirigami.Units.longDuration.
set(_panel_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-panel")
ecm_add_test(panelquicktest.cpp
    TEST_NAME panel
    LINK_LIBRARIES tokklcore tokklkde tokklcorefakes Qt6::Qml Qt6::Quick Qt6::QuickTest KF6::I18n KF6::I18nQml KF6::KirigamiPlatform)
set_target_properties(panel PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
target_compile_definitions(panel PRIVATE
    QUICK_TEST_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/qml"
    TOKKL_PLASMOID_ID="${TOKKL_PLASMOID_ID}"
    TOKKL_BACKEND_URI="${TOKKL_BACKEND_URI}"
    TOKKL_POMODORO_SOUND_FILES="${_sound_files}"
    TOKKL_STATUS_FIXTURE="${TOKKL_CORE_DIR}/autotests/statuspresentation.json")
set_tests_properties(panel PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;XDG_DATA_HOME=${_panel_xdg}/data;XDG_CONFIG_HOME=${_panel_xdg}/config;XDG_CACHE_HOME=${_panel_xdg}/cache;XDG_STATE_HOME=${_panel_xdg}/state")

add_test(NAME version
    COMMAND ${CMAKE_COMMAND}
        -DTOKKL_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -DTOKKL_CORE_DIR=${TOKKL_CORE_DIR}
        -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/version
        -P ${CMAKE_CURRENT_SOURCE_DIR}/versiontest.cmake)

add_test(NAME native-version
    COMMAND ${CMAKE_COMMAND}
        -DTOKKL_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/nativeversiontest.cmake)

add_test(NAME prune-package
    COMMAND ${CMAKE_COMMAND}
        -DTOKKL_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/prune
        -DECM_DIR=${ECM_DIR}
        -DPlasma_DIR=${Plasma_DIR}
        -DCMAKE_PREFIX_PATH=${CMAKE_PREFIX_PATH}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/prunetest.cmake)

# DESTDIR staging keeps the configured prefix, so the layout matches a
# real install.
set(_stage_dir "${CMAKE_CURRENT_BINARY_DIR}/stage")
add_test(NAME stage-install
    COMMAND ${CMAKE_COMMAND}
        -DSTAGE_DIR=${_stage_dir}
        -DBUILD_DIR=${CMAKE_BINARY_DIR}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/stageinstall.cmake)
set(_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg")
add_test(NAME stage-cleanup COMMAND ${CMAKE_COMMAND} -E rm -rf ${_stage_dir} ${_xdg})
set_tests_properties(stage-install PROPERTIES FIXTURES_SETUP staged)
set_tests_properties(stage-cleanup PROPERTIES FIXTURES_CLEANUP staged)

string(REPLACE "." "/" _backend_path "${TOKKL_BACKEND_URI}")
set(_staged_datadir "${_stage_dir}${KDE_INSTALL_FULL_DATADIR}")
set(_staged_qmldir "${_stage_dir}${KDE_INSTALL_FULL_QMLDIR}")

ecm_add_test(smokeloadtest.cpp
    TEST_NAME smokeload
    LINK_LIBRARIES Qt6::Test Qt6::Qml Qt6::Quick KF6::ConfigGui KF6::I18n KF6::Package Plasma::Plasma Plasma::PlasmaQuick)
# Qt imports QML modules from the executable's directory, where the
# build-tree backend lives.
set_target_properties(smokeload PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
target_compile_definitions(smokeload PRIVATE
    TOKKL_PLASMOID_ID="${TOKKL_PLASMOID_ID}"
    TOKKL_BACKEND_URI="${TOKKL_BACKEND_URI}"
    TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
    TOKKL_STAGED_PLASMOID_DIR="${_staged_datadir}/plasma/plasmoids/${TOKKL_PLASMOID_ID}"
    TOKKL_STAGED_BACKEND_DIR="${_staged_qmldir}/${_backend_path}"
    TOKKL_STAGED_ICON_DIR="${_stage_dir}${KDE_INSTALL_FULL_ICONDIR}")

# Private XDG dirs, so the user's widgets and settings neither shadow the
# staged files nor get written to.
set(_system_data_dirs "$ENV{XDG_DATA_DIRS}")
if(_system_data_dirs STREQUAL "")
    set(_system_data_dirs "/usr/local/share:/usr/share")
endif()
set_tests_properties(smokeload PROPERTIES
    FIXTURES_REQUIRED staged
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;QML_IMPORT_PATH=${_staged_qmldir};XDG_DATA_DIRS=${_staged_datadir}:${_system_data_dirs};XDG_DATA_HOME=${_xdg}/data;XDG_CONFIG_HOME=${_xdg}/config;XDG_CACHE_HOME=${_xdg}/cache;XDG_STATE_HOME=${_xdg}/state")
