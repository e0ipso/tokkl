# Not a CTest test: realserver.test.ts sets up the servers and runs it.
add_executable(realservertest realservertest.cpp)
target_link_libraries(realservertest PRIVATE tokklcore tokklcorefakes Qt6::Network Qt6::Test)
set_target_properties(realservertest PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
