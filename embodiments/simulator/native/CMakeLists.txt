cmake_minimum_required(VERSION 3.16)

project(sticks3_pc_runner LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Boost REQUIRED COMPONENTS system json)
find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

set(FIRMWARE_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../firmware/StickS3_Call/src")
set(TERMINAL_CORE_DIR "${FIRMWARE_SOURCE_DIR}/terminal_core")
set(FIRMWARE_APP_DIR "${FIRMWARE_SOURCE_DIR}/firmware_app")
set(TERMINAL_UI_DIR "${FIRMWARE_SOURCE_DIR}/terminal_ui")
set(ARDUINOJSON_DIR "${FIRMWARE_SOURCE_DIR}/../third_party/ArduinoJson/src")
set(M5GFX_EFONT_CN "${FIRMWARE_SOURCE_DIR}/../third_party/M5GFX/src/lgfx/Fonts/efont/lgfx_efont_cn.c")
set(LVGL_DIR "${CMAKE_CURRENT_LIST_DIR}/../third_party/lvgl")
set(LVGL_CONFIG "${CMAKE_CURRENT_LIST_DIR}/src/lv_conf.h")

if(NOT EXISTS "${LVGL_DIR}/CMakeLists.txt" OR NOT EXISTS "${LVGL_CONFIG}" OR NOT EXISTS "${M5GFX_EFONT_CN}")
  message(FATAL_ERROR "Pinned LVGL8, M5GFX efontCN and PC LVGL configuration are required for the simulator")
endif()
set(LV_CONF_INCLUDE_SIMPLE ON CACHE BOOL "" FORCE)
add_subdirectory("${LVGL_DIR}" "${CMAKE_BINARY_DIR}/lvgl")
target_include_directories(lvgl SYSTEM PUBLIC "${CMAKE_CURRENT_LIST_DIR}/src")
set_target_properties(lvgl_examples lvgl_demos PROPERTIES EXCLUDE_FROM_ALL TRUE)

add_library(sticks3_terminal_core STATIC
  "${TERMINAL_CORE_DIR}/terminal_core.cpp"
)
target_include_directories(sticks3_terminal_core PUBLIC "${TERMINAL_CORE_DIR}")
target_compile_features(sticks3_terminal_core PUBLIC cxx_std_11)

add_library(sticks3_firmware_app STATIC
  "${FIRMWARE_APP_DIR}/firmware_application.cpp"
  "${FIRMWARE_APP_DIR}/arduino_json_protocol.cpp"
  "${TERMINAL_UI_DIR}/terminal_view_model.cpp"
  "${TERMINAL_UI_DIR}/lvgl_terminal_scene.cpp"
  "${TERMINAL_UI_DIR}/m5_efont_cn_lvgl.cpp"
  "${M5GFX_EFONT_CN}"
)
target_include_directories(sticks3_firmware_app PUBLIC
  "${TERMINAL_CORE_DIR}"
  "${FIRMWARE_APP_DIR}"
  "${TERMINAL_UI_DIR}"
  "${ARDUINOJSON_DIR}"
)
target_link_libraries(sticks3_firmware_app PUBLIC sticks3_terminal_core lvgl)
target_compile_features(sticks3_firmware_app PUBLIC cxx_std_11)
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang" OR CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(sticks3_firmware_app PRIVATE -fdata-sections -ffunction-sections)
endif()

add_library(sticks3_pc_framebuffer STATIC
  src/framebuffer.cpp
  src/test_faults.cpp
)
target_include_directories(sticks3_pc_framebuffer PUBLIC
  "${TERMINAL_CORE_DIR}"
  "${FIRMWARE_APP_DIR}"
  "${TERMINAL_UI_DIR}"
  "${ARDUINOJSON_DIR}"
  "${CMAKE_CURRENT_LIST_DIR}/src"
)
target_link_libraries(sticks3_pc_framebuffer PUBLIC sticks3_firmware_app)
target_compile_features(sticks3_pc_framebuffer PUBLIC cxx_std_11)

add_executable(sticks3-pc-runner src/main.cpp)
target_link_libraries(sticks3-pc-runner PRIVATE
  sticks3_firmware_app
  sticks3_pc_framebuffer
  Boost::system
  Boost::json
  OpenSSL::SSL
  OpenSSL::Crypto
  Threads::Threads
)
target_compile_features(sticks3-pc-runner PRIVATE cxx_std_11)

add_executable(sticks3-terminal-core-test core_test.cpp)
target_link_libraries(sticks3-terminal-core-test PRIVATE sticks3_terminal_core)
target_compile_features(sticks3-terminal-core-test PRIVATE cxx_std_11)

add_executable(sticks3-pc-framebuffer-test framebuffer_test.cpp)
target_link_libraries(sticks3-pc-framebuffer-test PRIVATE sticks3_pc_framebuffer)
target_compile_features(sticks3-pc-framebuffer-test PRIVATE cxx_std_11)

add_executable(sticks3-m5-efont-cn-lvgl-test m5_efont_cn_lvgl_test.cpp)
target_link_libraries(sticks3-m5-efont-cn-lvgl-test PRIVATE sticks3_firmware_app)
target_compile_features(sticks3-m5-efont-cn-lvgl-test PRIVATE cxx_std_11)

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang" OR CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  foreach(target sticks3-pc-runner sticks3-terminal-core-test sticks3-pc-framebuffer-test sticks3-m5-efont-cn-lvgl-test)
    target_link_options(${target} PRIVATE -Wl,--gc-sections)
  endforeach()
endif()

enable_testing()
add_test(NAME sticks3-pc-runner-help COMMAND sticks3-pc-runner --help)
add_test(NAME sticks3-terminal-core-test COMMAND sticks3-terminal-core-test)
add_test(NAME sticks3-pc-framebuffer-test COMMAND sticks3-pc-framebuffer-test)
add_test(NAME sticks3-m5-efont-cn-lvgl-test COMMAND sticks3-m5-efont-cn-lvgl-test)
