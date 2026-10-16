# The companion against real Tokkl servers. Not a CTest test: it needs the
# servers, the proxy and the fixtures that realserver.test.ts sets up, and
# that script runs this binary. ci/realserver.sh shows how.
add_executable(realservertest realservertest.cpp)
target_link_libraries(realservertest PRIVATE tokklcore tokklcorefakes Qt6::Network Qt6::Test)
set_target_properties(realservertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
