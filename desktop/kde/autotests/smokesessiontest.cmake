# A desktop service installed in the temporary profile must not be activated
# by the installed-widget smoke check, even when it requests that service.
file(MAKE_DIRECTORY "${WORK_DIR}/dbus-1/services")
file(WRITE "${WORK_DIR}/dbus-1/services/org.tokkl.SmokeProbe.service"
    "[D-BUS Service]\nName=org.tokkl.SmokeProbe\nExec=/bin/false\n")
execute_process(
    COMMAND "${CMAKE_COMMAND}" -E env "XDG_DATA_HOME=${WORK_DIR}"
        "${DBUS_RUN_SESSION}" --config-file "${SESSION_CONFIG}" --
        "${DBUS_SEND}" --session --print-reply --dest=org.freedesktop.DBus
        /org/freedesktop/DBus org.freedesktop.DBus.StartServiceByName
        string:org.tokkl.SmokeProbe uint32:0
    RESULT_VARIABLE result OUTPUT_VARIABLE output ERROR_VARIABLE error)
if(result EQUAL 0 OR NOT error MATCHES "org.freedesktop.DBus.Error.ServiceUnknown")
    message(FATAL_ERROR "The smoke session allowed desktop service activation: ${result}\n${output}\n${error}")
endif()
file(REMOVE_RECURSE "${WORK_DIR}")
