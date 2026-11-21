# EryXen API and account compatibility

OmegA-FCA retains its first-party transport and account-security boundary while exposing the public FCA methods used by GoatBot.

## External modules

Both extension forms are supported. OmegA accepts an object of named functions; the EryXen overload accepts a module name and a factory returning a function. The factory receives a restricted defaultFuncs object containing available HTTP helpers, the FCA API, and a context with the authenticated userID. It does not expose internal cookie jars, raw session objects, or private transport internals.

## ImgBB image hosting

Call uploadImageToImgbb with a remote HTTPS image URL. It resolves to the hosted image URL. Configure a key through login options as imgbbApiKey, or through FCA_IMGBB_API_KEY / IMGBB_API_KEY. The key is never embedded in source code or included in thrown error messages. The legacy error-first callback form is also supported.

## Existing API coverage

Thread, user, group, search, history, friend-list, profile adapter, and read-receipt methods remain provided by the existing first-party API facade. Private Facebook endpoints remain subject to protocol changes; synthetic tests do not establish live Facebook acceptance.
