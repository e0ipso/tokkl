# The D-Bus activation file, the systemd user unit and the interface
# description. The first call to org.tokkl.Timer1 makes the bus start the
# unit (or run tokkl-timerd directly on a bus without systemd).

set(TOKKL_SYSTEMD_USER_UNIT_DIR "lib/systemd/user"
    CACHE PATH "systemd user unit directory, relative to the install prefix")

set(TOKKL_TIMERD_EXEC "${CMAKE_INSTALL_FULL_BINDIR}/tokkl-timerd")
configure_file(org.tokkl.Timer1.service.in org.tokkl.Timer1.service @ONLY)
configure_file(tokkl-timerd.service.in tokkl-timerd.service @ONLY)

install(FILES "${CMAKE_CURRENT_BINARY_DIR}/org.tokkl.Timer1.service"
    DESTINATION ${CMAKE_INSTALL_DATADIR}/dbus-1/services)
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/tokkl-timerd.service"
    DESTINATION ${TOKKL_SYSTEMD_USER_UNIT_DIR})
install(FILES org.tokkl.Timer1.xml
    DESTINATION ${CMAKE_INSTALL_DATADIR}/dbus-1/interfaces)
