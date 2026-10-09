#pragma once
#include <atomic>
#include <memory>
namespace origami_test {
inline std::shared_ptr<const std::atomic<bool>> authorized() {
    return std::make_shared<const std::atomic<bool>>(true);
}
}
