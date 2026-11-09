cmake_minimum_required(VERSION 3.18)
project(layoutlens_engine LANGUAGES CXX)

option(LL_OPENMP "Enable OpenMP parallel chains / kernels" ON)
option(LL_CUDA   "Build CUDA batched evaluation" OFF)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_executable(ll_engine src/main.cpp src/geometry.cpp src/walkability.cpp src/evaluate.cpp src/optimizer.cpp)
target_include_directories(ll_engine PRIVATE include)

if(LL_OPENMP)
  find_package(OpenMP)
  if(OpenMP_CXX_FOUND)
    target_link_libraries(ll_engine PRIVATE OpenMP::OpenMP_CXX)
  endif()
endif()

if(LL_CUDA)
  enable_language(CUDA)
  add_library(ll_cuda STATIC src/cuda/batch_eval.cu)
  set_target_properties(ll_cuda PROPERTIES CUDA_ARCHITECTURES "75;86;89")
  target_link_libraries(ll_engine PRIVATE ll_cuda)
  target_compile_definitions(ll_engine PRIVATE LL_WITH_CUDA=1)
endif()
