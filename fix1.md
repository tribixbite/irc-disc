# Feature Verification & Fix Specification

## 1. Verification Summary

### Verified Features
| Feature | Status | Notes |
| :--- | :--- | :--- |
| **Message Not Sent Notification** | ✅ **Verified** | Implemented in `lib/bot.ts`. Bot explicitly checks connection state before sending and replies to user if IRC is down. |
| **PM Persistence** | ✅ **Verified** | Implemented in `lib/persistence.ts`. SQLite storage with WAL mode correctly handles PM thread lifecycle (save, get, update, load all). |
| **S3 File Management** | ✅ **Verified** | Implemented in `lib/s3-uploader.ts`. Core S3 wrapper functions (upload, list, delete) work as expected. |

### Identified Issues
| Issue | Severity | Description |
| :--- | :--- | :--- |
| **S3 Rate Limiting Dormant** | 🔴 **Critical** | The `S3RateLimiter` class (`lib/s3-rate-limiter.ts`) is fully implemented and tested but **never instantiated or used** by the `S3Uploader`. Users can currently upload files without rate limits. |
| **Unstable Test Suite** | 🟡 **Medium** | `test/bot-events.test.ts` has 6 failures related to mock/spy assertions (e.g., checking logging output). This indicates brittle tests rather than broken functionality, but it hinders CI reliability. |

---

## 2. Specification Requirements

### 2.1. S3 Rate Limiting Integration
The `S3Uploader` class must integrate the `S3RateLimiter` to protect against abuse.

**Requirements:**
1.  **Instantiation:** `S3Uploader` must accept an optional `rateLimitConfig` or `S3RateLimiter` instance in its constructor.
    *   If no config is provided, it should use `createDefaultS3RateLimiter()` (5 uploads per 10 mins).
2.  **Enforcement:** The `uploadFile` method must call `rateLimiter.checkLimit(userId)` before attempting an upload.
    *   **Input:** `userId` (string).
    *   **Check:** If `result.allowed` is `false`.
    *   **Action:** Throw an error with a message containing the retry time: `"Rate limit exceeded. Try again in X seconds."`
3.  **Context:** `uploadFile` currently signature is `(buffer, originalFilename, customFilename, contentType)`. It **needs `userId`** added to the arguments to perform per-user limiting.
4.  **Updates:** The `Bot` class (consumer of `S3Uploader`) needs to pass the `userId` when calling `uploadAttachmentToS3`.

### 2.2. Test Suite Stabilization
The `test/bot-events.test.ts` file needs to be updated to correctly mock and spy on dependencies.

**Requirements:**
1.  **Mocking:** Ensure `logger` is properly mocked using `vi.mock` and that spies are cleared/reset between tests.
2.  **Arguments:** Fix assertions checking for specific log messages where the actual output might vary slightly (e.g., color codes, timestamps) or where the spy wasn't registered correctly.

---

## 3. Detailed To-Do List

### Phase 1: S3 Rate Limiter Integration

1.  **Refactor `S3Uploader` Class (`lib/s3-uploader.ts`)**
    *   Import `S3RateLimiter` and `createDefaultS3RateLimiter` from `./s3-rate-limiter`.
    *   Update `S3Config` interface to include optional `rateLimitConfig`.
    *   Add `private rateLimiter: S3RateLimiter` property.
    *   Initialize `rateLimiter` in constructor.
    *   Update `uploadFile` method signature to accept `userId: string`.
    *   Implement `checkLimit` logic at the start of `uploadFile`.

2.  **Update `Bot` Class (`lib/bot.ts`)**
    *   Locate usage of `this.s3Uploader.uploadFile`.
    *   Pass `message.author.id` as the `userId` argument.

3.  **Update Slash Commands (`lib/slash-commands.ts`)**
    *   If slash commands use `s3Uploader`, ensure they also pass `interaction.user.id`.

4.  **Add Verification Test**
    *   Create/Update `test/s3-integration.test.ts` to verify that `uploadFile` throws when the limit is exceeded.

### Phase 2: Test Suite Repairs

1.  **Fix `test/bot-events.test.ts`**
    *   Review failures in "should log on discord ready event".
    *   Review failures in "should log on irc registered event".
    *   Review failures in "should error log on error events".
    *   Ensure `logger` spies are correctly capturing calls.

2.  **Verify All Tests Pass**
    *   Run `npm run test` to ensure the full suite is green.
