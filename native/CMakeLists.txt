cmake_minimum_required(VERSION 3.24)
project(maki CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
  add_compile_options(/W3 /utf-8 /fp:precise)
  add_compile_definitions(_CRT_SECURE_NO_WARNINGS NOMINMAX)
endif()

# raylib is fetched at configure time, no install needed.
include(FetchContent)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_GAMES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(raylib
  URL https://github.com/raysan5/raylib/archive/refs/tags/5.5.tar.gz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(raylib)

# Simulation + pixel compositor: no raylib, shared by the game and the tools.
add_library(maki_core STATIC
  src/core/grid.cpp src/core/debris.cpp src/core/fire.cpp src/core/gas.cpp
  src/core/nav.cpp src/core/worldgen.cpp src/core/tank.cpp src/core/ai.cpp
  src/core/squads.cpp src/core/rewards.cpp src/core/game.cpp
  src/core/palette.cpp src/core/compose.cpp)
target_include_directories(maki_core PUBLIC src/core)

file(GLOB APP_SOURCES CONFIGURE_DEPENDS src/app/*.cpp)
add_executable(maki ${APP_SOURCES})
target_link_libraries(maki PRIVATE maki_core raylib)
target_compile_definitions(maki PRIVATE MAKI_ASSETS="${CMAKE_SOURCE_DIR}/assets")
if(WIN32)
  set_target_properties(maki PROPERTIES WIN32_EXECUTABLE $<CONFIG:Release>)
  target_link_options(maki PRIVATE $<$<CONFIG:Release>:/ENTRY:mainCRTStartup>)
endif()
# ship the assets next to the exe
add_custom_command(TARGET maki POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/assets $<TARGET_FILE_DIR:maki>/assets)

add_executable(maki_bench tools/bench.cpp)
target_link_libraries(maki_bench PRIVATE maki_core)

add_executable(maki_snapshot tools/snapshot.cpp)
target_link_libraries(maki_snapshot PRIVATE maki_core raylib)

add_executable(maki_mapsum tools/mapsum.cpp)
target_link_libraries(maki_mapsum PRIVATE maki_core)

add_executable(maki_gasbench tools/gasbench.cpp)
target_link_libraries(maki_gasbench PRIVATE maki_core)
