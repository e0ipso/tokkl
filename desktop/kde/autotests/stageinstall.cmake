# Usage: cmake -DSTAGE_DIR=<dir> -DBUILD_DIR=<build> -P stageinstall.cmake
file(REMOVE_RECURSE "${STAGE_DIR}")
execute_process(
    COMMAND ${CMAKE_COMMAND} -E env DESTDIR=${STAGE_DIR} ${CMAKE_COMMAND} --install ${BUILD_DIR}
    RESULT_VARIABLE result)
if(NOT result EQUAL 0)
    message(FATAL_ERROR "Staged install into ${STAGE_DIR} failed: ${result}")
endif()
