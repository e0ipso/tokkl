# The companion against real Tokkl servers. Not a CTest test: it needs the
# servers, the proxy and the fixtures that realserver.test.ts sets up, and
# that script runs this binary. ci/realserver.sh shows how.
add_executable(realservertest realservertest.cpp ${PROJECT_SOURCE_DIR}/autotests/fakes.h)
target_include_directories(realservertest PRIVATE ${PROJECT_SOURCE_DIR}/autotests)
target_link_libraries(realservertest PRIVATE tokklcore Qt6::Network Qt6::Test)
set_target_properties(realservertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
