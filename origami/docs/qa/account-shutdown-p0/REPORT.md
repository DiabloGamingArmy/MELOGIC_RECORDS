# Account worker shutdown repair

Status: root cause proven and repaired; formal P0 release sign-off remains pending the real AU/VST3 host matrix and unautomated account-state cases listed below. No release deployment or installed application replacement was performed.

## 1. Baseline

Branch `mct-origami-nodes-visual-feedback-p03`, baseline `f1c846e3cb7e266cb30f77b777fa9b3d280c2e0a`. The existing WASM manifest timestamp modification was preserved and excluded.

## 2. Reproduction

Unmodified Release Standalone: normal Cmd+Q after real account restore/authorization exited 139 (PID 34374). The user supplied the matching SIGSEGV report. NSZombieEnabled did not report a specific zombie. Another baseline Cmd+Q was sampled while main joined Service during static finalization and its worker was still inside Security's SecItemCopyMatching. A baseline debugger run also reproduced the exact crash using programmatic JUCE quit.

The activation gate was visible during restoration; a complete separate baseline matrix of signed-out, pending browser auth, deliberate logout, and window-close cases was not performed. Existing user account state was retained.

## 3. Crashing Thread 3

This is the account Service's std::thread, created by the constructor lambda and executing Service::run/Coordinator::step/KeychainStore::load. At crash it has returned from C++ entry and is in pthread's Objective-C TLS cleanup. LLDB numbers it thread #4 (zero-based crash report Thread 3). New worker name: `Melogic Account`.

## 4. Exact root cause

The static shared_ptr<Service> retained the worker until C++ static finalization. JUCE's dynamically registered `JUCE_URLDelegate_…` NSURLSessionTaskDelegate class was initialized later than that shared_ptr and disposed earlier during reverse finalization. Foundation networking temporaries on the std::thread were not covered by a worker-owned autorelease scope. A delegate instance survived in the thread's deferred native cleanup after its Objective-C class was disposed.

LLDB stopped objc_disposeClassPair with class address `0x93ba6c180`, called from `juce::ObjCClass<NSObject<NSURLSessionTaskDelegate>>::~ObjCClass`. After continuing, objc_msgSend faulted on the account worker with decoded class register x16 **equal to that exact address**. Object x0 was `0x9388add20`, whose first word was `0x030000093ba6c181`. This identifies the disposed class rather than inferring it from CFNetwork's presence. See `debugger-evidence.txt`.

## 5. Why autorelease pool cleanup crashed

TLS cleanup sent release to an instance whose dynamically allocated class had already been disposed. The fault instruction read dispatch/cache data through x13=0. The matching disposed class address establishes the class-lifetime violation. The a1/a3 patterns recur but are not used to infer a particular allocator diagnosis. try/catch does not fix or intercept this native fault.

## 6. Ownership before

A function-local static shared_ptr owned Service regardless of processor/editor references. Its destructor signalled stop, cancelled transport, and joined the worker during process exit. UI destruction did not release this final strong owner.

## 7. Ownership after

The registry holds only weak_ptr<Service>. Processor/editor shared_ptrs preserve the service while they use it. The last plugin owner releases it during ordinary plugin lifetime. Standalone additionally owns an explicit application lease and stops it in JUCEApplication::shutdown. Test fixture strong ownership exists only in test-support code and has an explicit release operation.

## 8. Shutdown ordering

`shutdown()` serializes joiners, marks stop under the state mutex, advances the epoch, rejects new commands, clears pending browser/key publication, closes the runtime authorization atomic, permanently stops the backend, wakes the worker, and joins outside all locks the worker needs. Coordinator results from stale epochs cannot publish. The destructor delegates to the same idempotent shutdown. Constructor validates dependencies before creating a joinable thread.

## 9. Autorelease ownership

The account std::thread establishes its own outer JUCE pool before native thread naming and its worker loop. Each bounded Coordinator step has a nested lexical pool that drains before state publication/CV wait. Streams, responses, CoreFoundation owners, and native networking cleanup finish while class definitions are valid; the outer pool drains before thread return. No pool crosses threads.

A native Objective-C fixture creates an autoreleased object on the worker, records dealloc and creating pthread identity, and requires dealloc before shutdown. Fifty iterations pass. This test caught an initial C++ macro scope that retained the per-step pool through the idle wait; the final lexical scope fixes it.

## 10. Callback/network audit

Service has no observer registry or asynchronous UI callback queue. The constructor [this] and stale-work [this] lambdas execute only on the joined worker. Snapshot/browser publication is polled under the state mutex by the UI; shutdown clears browser delivery and rejects later work. ActivationPanel's local callbacks belong to its components, not the service.

FirebaseBackend uses synchronous worker-owned WebInputStream objects. Its protected active raw pointer is unregistered before stream destruction. cancel holds the transport mutex while touching it. Permanent backend shutdown prevents a later operation resetting its cancellation epoch and starting a request after a blocked Keychain read returns. Registration also checks the terminal flag, closing the stream-creation race.

JUCE internally uses NSURLSession callbacks: URLConnectionState owns its token/shared session; TaskToken destruction waits for listener removal before the listener object can disappear. Native class registration must outlive that cleanup. No host/UI pointer is captured by this transport.

## 11. Standalone integration

The existing custom OrigamiStandaloneApplication is the sole application lifecycle owner. Its shutdown stops the diagnostic/probe timers, calls account shutdown, destroys the window/audio processor and releases the application lease, then saves existing app/device preferences. No alternate signal handler, atexit handler, detach, forced exit, or shutdown delay was added. The diagnostic probe invokes JUCEApplicationBase::quit, entering this same lifecycle.

## 12. AU/VST3 treatment

StandaloneApp.cpp is compiled only into Standalone. AU/VST3 do not call application quit or explicitly stop the service when one instance/editor closes. Weak registry plus live shared owners permits continued service with other instances and stops it when the final owner disappears. Focused tests verify live-owner retention and final weak-reference expiration. Different format binaries may have separate in-process registries; canonical secure storage continues to coordinate account state across them.

## 13. Deadlocks and latency

shutdownMutex serializes only external joiners; the worker never takes it. State/transport locks are released before join. The worker never waits on UI dispatch. Active mocked transport is cancelled and joined in less than one second. Both 50-cycle process runs completed normally. Security.framework calls themselves are synchronous and do not expose a cancellation API here; an OS Keychain prompt/service stall can still delay completion. This repair does not claim a hard deadline for arbitrary OS service failures.

## 14. Lifecycle tests

Account suite: 1,076 checks, including 1,000 rapid construct/shutdown/destroy iterations, queued commands, concurrent/repeated shutdown, rejected commands after stop, blocked mock transport, invalid dependency construction, contained store failure, shared owner retention/release, fifty native autorelease units, and persisted-session restoration across two service lifetimes. Observer attach/remove and queued UI callback cases are inapplicable because Service has neither facility.

## 15. Repeated Standalone quit

50 initial process cycles against existing account storage: all exit 0, all shutdown markers complete, no new crash reports; 12 completed authorization before quit. Delays 1/100/500/3000/5000ms cover immediate shutdown, restoration in flight, and completed operations. Maximum whole-process time 7.498s including initialization and requested runtime.

That initial loop caused repeated user Keychain approval prompts and should not be repeated. The shipped test script now requires a test-only probe that injects isolated in-memory storage. A further 50 isolated process cycles also passed without login Keychain access. Both JSON summaries are retained, with no session content.

## 16. Persistence

Real account session and successful authorization restored repeatedly after clean process quits (12 observed authorizations during initial torture). Shutdown contains no Store::erase or logout command. Isolated shared-store tests verify credentials and identity remain present and authorization restores in a new Service. Disposable Keychain round-trip tests continue passing. No real logout/redeem was performed solely for this investigation.

## 17. Host and quit routes

Actual Cmd+Q: exit 0 after repair; user independently observed no error. Actual macOS MCT Origami → Quit: clean Release exit 0 and complete shutdown markers. Main window traffic-light close after an isolated failed sign-in: exit 0 and complete markers; current Standalone behavior requests application quit on close, so no second quit is needed. Programmatic JUCE quit: 100 successful process cycles across the two runs.

Dock quit was not separately exercised. Real Logic AU and third-party VST3 host install/load/multiple-instance/save/quit were not executed in this pass. Existing real-processor/editor tests cover shared state, multiple ownership, editor recreation, history/gate behavior, and audio authorization, but are not a substitute for that host matrix. Installed plugin bundles were not overwritten, and further production-account loops were stopped after the password-prompt complaint.

## 18. Builds and regressions

Clean new Release build tree: `origami/build-p0-release`; Standalone/AU/VST3 built successfully, probe OFF. Full native CTest after lifetime/transport/pool repair: 12/12, including state/preset/history, activation gate/welcome, account, B01 DSP torture and EQ headroom. Licensing backend emulator tests: 15/15. Native HTTP contract: 23/23; full UBSan CTest: 12/12 (289.96s), including B01 and EQ. After the later secure-store denial retry refinement, focused account/activation checks were rerun; details are recorded in validation.txt.

ASan was not claimed or retried; the known independent Apple runtime pre-main failure remains outside this patch. No oscillator/filter/FX/routing/mixer/master/modulation/audio engine algorithm changed. Account work remains outside processBlock; audio reads the existing authorization atomic.

## 19. Limitations and password-prompt mitigation

Formal release sign-off remains open for Dock/real host testing and a fully manual real signed-out/browser-pending/logout matrix. Synthetic backend and gate tests cover those states without mutating the user's account. No installed application was replaced.

Development binaries were confirmed linker/ad hoc signed. Apple documents that ad hoc designated requirements are tied to a specific code build, so rebuilding may invalidate remembered Keychain access. Automated probes now use isolated storage and refuse binaries without the isolated probe marker. Secure-store failure/denial is latched until an explicit account retry, so the two-second worker poll cannot repeatedly request OS approval. A 30-poll regression proves no further store reads after denial, and explicit Restore still recovers. `ORIGAMI_CODESIGN_IDENTITY` optionally signs Standalone after build with a stable selected local identity and `studio.melogic.origami` identifier. It defaults empty; no private signing key was used automatically, no Keychain ACL was broadened, and no credential was deleted. A valid Apple Development identity is available locally. Selecting Always Allow for a trusted stable signed app is a user action; this pass never enters the user's password.

References: [Apple designated requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements), [Apple Keychain access choices](https://support.apple.com/guide/keychain-access/kyca1243/mac).

## 20. Commit and push

Final commit/push confirmation is supplied in the final chat response. Source, focused tests, probe script, and credential-free evidence are committed together; unrelated WASM timestamp is excluded.
