include(ECMAddTests)

# Unit tests of the API client, connection state and timer controller,
# against the scripted transport, credential store and clock in fakes.h, and
# of the real transport against an in-process loopback server. They never
# reach KDE Wallet, another host or real configuration; private XDG dirs make
# sure of the last.
set(_unit_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-unit")
ecm_add_test(apitest.cpp
    TEST_NAME api
    LINK_LIBRARIES tokklcore Qt6::Test)
ecm_add_test(connectiontest.cpp fakes.h
    TEST_NAME connection
    LINK_LIBRARIES tokklcore Qt6::Test)
ecm_add_test(networktransporttest.cpp
    TEST_NAME networktransport
    LINK_LIBRARIES tokklcore Qt6::Test)
ecm_add_test(timercontrollertest.cpp fakes.h
    TEST_NAME timer
    LINK_LIBRARIES tokklcore Qt6::Test)
set_tests_properties(api connection networktransport timer PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;XDG_DATA_HOME=${_unit_xdg}/data;XDG_CONFIG_HOME=${_unit_xdg}/config;XDG_CACHE_HOME=${_unit_xdg}/cache;XDG_STATE_HOME=${_unit_xdg}/state")

# The panel item and its menu (package/contents/ui), driven by QtQuickTest
# through the QML tests in qml/. The backend types come from tokklcore, wired
# to the fakes; the test never loads main.qml, the real connection or a
# plugin copy of the backend. Kept out of bin/, where the build-tree backend
# module lives.
set(_panel_xdg "${CMAKE_CURRENT_BINARY_DIR}/xdg-panel")
ecm_add_test(panelquicktest.cpp fakes.h
    TEST_NAME panel
    LINK_LIBRARIES tokklcore Qt6::Qml Qt6::Quick Qt6::QuickTest KF6::I18n KF6::I18nQml)
set_target_properties(panel PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
target_compile_definitions(panel PRIVATE
    QUICK_TEST_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/qml"
    TOKKL_PLASMOID_ID="${TOKKL_PLASMOID_ID}"
    TOKKL_BACKEND_URI="${TOKKL_BACKEND_URI}")
set_tests_properties(panel PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;XDG_DATA_HOME=${_panel_xdg}/data;XDG_CONFIG_HOME=${_panel_xdg}/config;XDG_CACHE_HOME=${_panel_xdg}/cache;XDG_STATE_HOME=${_panel_xdg}/state")

# Version resolution and metadata stamping, in script mode.
add_test(NAME version
    COMMAND ${CMAKE_COMMAND}
        -DTOKKL_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/version
        -P ${CMAKE_CURRENT_SOURCE_DIR}/versiontest.cmake)

# Package versions from scripts/native-version.sh: accepted and refused
# forms, and dpkg and rpm order where those tools are installed.
add_test(NAME native-version
    COMMAND ${CMAKE_COMMAND}
        -DTOKKL_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/nativeversiontest.cmake)

# A source file removed from package/contents/ must leave the package.
add_test(NAME prune-package
    COMMAND ${CMAKE_COMMAND}
        -DTOKKL_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/prune
        -DECM_DIR=${ECM_DIR}
        -DPlasma_DIR=${Plasma_DIR}
        -DCMAKE_PREFIX_PATH=${CMAKE_PREFIX_PATH}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/prunetest.cmake)

# Stage the install under the build tree with DESTDIR. The prefix stays as
# configured, so the layout matches a real install.
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
# Keep the test out of bin/: Qt imports QML modules from the executable's
# directory, where the build-tree backend lives.
set_target_properties(smokeload PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
target_compile_definitions(smokeload PRIVATE
    TOKKL_PLASMOID_ID="${TOKKL_PLASMOID_ID}"
    TOKKL_BACKEND_URI="${TOKKL_BACKEND_URI}"
    TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
    TOKKL_STAGED_PLASMOID_DIR="${_staged_datadir}/plasma/plasmoids/${TOKKL_PLASMOID_ID}"
    TOKKL_STAGED_BACKEND_DIR="${_staged_qmldir}/${_backend_path}")

# Offscreen, with private XDG dirs so the user's own widgets, settings and
# caches neither shadow the staged files nor get written to.
set(_system_data_dirs "$ENV{XDG_DATA_DIRS}")
if(_system_data_dirs STREQUAL "")
    set(_system_data_dirs "/usr/local/share:/usr/share")
endif()
set_tests_properties(smokeload PROPERTIES
    FIXTURES_REQUIRED staged
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;QML_IMPORT_PATH=${_staged_qmldir};XDG_DATA_DIRS=${_staged_datadir}:${_system_data_dirs};XDG_DATA_HOME=${_xdg}/data;XDG_CONFIG_HOME=${_xdg}/config;XDG_CACHE_HOME=${_xdg}/cache;XDG_STATE_HOME=${_xdg}/state")
