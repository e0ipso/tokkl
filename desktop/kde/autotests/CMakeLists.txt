include(ECMAddTests)

# Version resolution and metadata stamping, in script mode.
add_test(NAME version
    COMMAND ${CMAKE_COMMAND}
        -DTOKKL_SOURCE_DIR=${PROJECT_SOURCE_DIR}
        -DWORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/version
        -P ${CMAKE_CURRENT_SOURCE_DIR}/versiontest.cmake)

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
    LINK_LIBRARIES Qt6::Test Qt6::Qml Qt6::Quick KF6::Package Plasma::Plasma Plasma::PlasmaQuick)
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
