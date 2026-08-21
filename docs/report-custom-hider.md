1.create marker page: can compile marker in mobile but can't compile marker in pc 
chrome console log repeort:
    [contentLogger
    controller-mGt1s8dJ.js:36927 Could not get context for WebGL version 2
    controller-mGt1s8dJ.js:36927 Could not get context for WebGL version 1
    controller-mGt1s8dJ.js:624 Initialization of backend webgl failed
    ln @ controller-mGt1s8dJ.js:624
    initializeBackend @ controller-mGt1s8dJ.js:2470
    initializeBackendsAndReturnBest @ controller-mGt1s8dJ.js:2486
    get backend @ controller-mGt1s8dJ.js:2405
    makeTensor @ controller-mGt1s8dJ.js:2673
    wa @ controller-mGt1s8dJ.js:3165
    $e @ controller-mGt1s8dJ.js:3185
    (anonymous) @ controller-mGt1s8dJ.js:55072
    (anonymous) @ controller-mGt1s8dJ.js:2510
    scopedRun @ controller-mGt1s8dJ.js:2515
    tidy @ controller-mGt1s8dJ.js:2510
    D @ controller-mGt1s8dJ.js:3321
    MY @ controller-mGt1s8dJ.js:55071
    await in MY
    (anonymous) @ controller-mGt1s8dJ.js:55009
    compileImageTargets @ controller-mGt1s8dJ.js:54992
    compileTarget @ uploadApp.js:132
    await in compileTarget
    (anonymous) @ uploadApp.js:290
    controller-mGt1s8dJ.js:624 Error: WebGL is not supported on this device
        at new Cu (controller-mGt1s8dJ.js:40284:13)
        at Object.factory (controller-mGt1s8dJ.js:40836:9)
        at mr.initializeBackend (controller-mGt1s8dJ.js:2463:19)
        at mr.initializeBackendsAndReturnBest (controller-mGt1s8dJ.js:2486:59)
        at get backend (controller-mGt1s8dJ.js:2405:46)
        at mr.makeTensor (controller-mGt1s8dJ.js:2673:39)
        at wa (controller-mGt1s8dJ.js:3165:113)
        at $e (controller-mGt1s8dJ.js:3185:10)
        at controller-mGt1s8dJ.js:55072:17
        at controller-mGt1s8dJ.js:2510:88
    ln @ controller-mGt1s8dJ.js:624
    initializeBackend @ controller-mGt1s8dJ.js:2470
    initializeBackendsAndReturnBest @ controller-mGt1s8dJ.js:2486
    get backend @ controller-mGt1s8dJ.js:2405
    makeTensor @ controller-mGt1s8dJ.js:2673
    wa @ controller-mGt1s8dJ.js:3165
    $e @ controller-mGt1s8dJ.js:3185
    (anonymous) @ controller-mGt1s8dJ.js:55072
    (anonymous) @ controller-mGt1s8dJ.js:2510
    scopedRun @ controller-mGt1s8dJ.js:2515
    tidy @ controller-mGt1s8dJ.js:2510
    D @ controller-mGt1s8dJ.js:3321
    MY @ controller-mGt1s8dJ.js:55071
    await in MY
    (anonymous) @ controller-mGt1s8dJ.js:55009
    compileImageTargets @ controller-mGt1s8dJ.js:54992
    compileTarget @ uploadApp.js:132
    await in compileTarget
    (anonymous) @ uploadApp.js:290
    controller-mGt1s8dJ.js:2562 Uncaught (in promise) Error: Kernel 'BinomialFilter' not registered for backend 'cpu'
        at mr.runKernel (controller-mGt1s8dJ.js:2562:13)
        at controller-mGt1s8dJ.js:53766:25
        at controller-mGt1s8dJ.js:2510:88
        at mr.scopedRun (controller-mGt1s8dJ.js:2515:17)
        at mr.tidy (controller-mGt1s8dJ.js:2510:17)
        at D (controller-mGt1s8dJ.js:3321:12)
        at vC._applyFilter (controller-mGt1s8dJ.js:53766:12)
        at vC.detect (controller-mGt1s8dJ.js:53570:26)
        at controller-mGt1s8dJ.js:55072:111
        at controller-mGt1s8dJ.js:2510:88
    runKernel @ controller-mGt1s8dJ.js:2562
    (anonymous) @ controller-mGt1s8dJ.js:53766
    (anonymous) @ controller-mGt1s8dJ.js:2510
    scopedRun @ controller-mGt1s8dJ.js:2515
    tidy @ controller-mGt1s8dJ.js:2510
    D @ controller-mGt1s8dJ.js:3321
    _applyFilter @ controller-mGt1s8dJ.js:53766
    detect @ controller-mGt1s8dJ.js:53570
    (anonymous) @ controller-mGt1s8dJ.js:55072
    (anonymous) @ controller-mGt1s8dJ.js:2510
    scopedRun @ controller-mGt1s8dJ.js:2515
    tidy @ controller-mGt1s8dJ.js:2510
    D @ controller-mGt1s8dJ.js:3321
    MY @ controller-mGt1s8dJ.js:55071
    await in MY
    (anonymous) @ controller-mGt1s8dJ.js:55009
    compileImageTargets @ controller-mGt1s8dJ.js:54992
    compileTarget @ uploadApp.js:132
    await in compileTarget
    (anonymous) @ uploadApp.js:290
    2upload.html:1 Uncaught (in promise) Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received]

2.lock position page: should use the same ui as uncustom hider (docs\img-ref\UI_1_1.png) but show only one 'button.pose'