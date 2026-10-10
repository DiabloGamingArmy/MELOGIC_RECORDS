#include <cstdlib>
#include <cstring>
#include <unistd.h>

// Markers use write, so a startup failure cannot be confused with buffered output.
__attribute__((constructor)) static void enteredInitializers() {
    constexpr char marker[] = "PROBE constructor entered\n";
    (void)::write(STDERR_FILENO, marker, sizeof(marker) - 1);
}

int main(int argc, char** argv) {
    constexpr char marker[] = "PROBE main entered\n";
    (void)::write(STDERR_FILENO, marker, sizeof(marker) - 1);
    auto* allocation = static_cast<unsigned char*>(std::malloc(16));
    if (!allocation) return 1;
    volatile unsigned char* observed = allocation;
    observed[3] = 42;
    const int value = observed[3];
    std::free(allocation);
    // Explicit opt-in expected failure. Never register this as a passing test.
    if (argc == 2 && std::strcmp(argv[1], "--invalid") == 0)
        return observed[3];
    return value == 42 ? 0 : 1;
}
