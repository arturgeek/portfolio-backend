## Portfolio Backend (News Aggregator Lambda)

This project is a small TypeScript backend intended to run as an AWS Lambda function. It aggregates a few public RSS/Atom feeds, caches the result as JSON in S3, and is deployed via GitHub Actions.

### What it does

- **Aggregates feeds**: Uses `rss-parser` to fetch items from:
  - Cursor feed (custom Any-Feeds URL)
  - InfoQ (`https://feed.infoq.com/`)
  - Hacker News (`https://news.ycombinator.com/rss`)
- **Caches per day**: For each day, it writes a JSON file to S3 under `news-cache/YYYY-MM-DD.json`.
- **Serves from cache**:
  - If the file for today exists in S3, it returns that JSON.
  - If it does not exist, it fetches the feeds, writes the JSON, and returns it.
- **CORS + JSON response**: The Lambda returns a JSON body with CORS enabled (`Access-Control-Allow-Origin: *`), ready to be consumed by a frontend.

The main handler code lives in `src/aggregator.ts` and is exported as `handler`.

### Tech stack

- **Language**: TypeScript
- **Bundler**: `esbuild`
- **AWS SDK**: `@aws-sdk/client-s3` (v3)
- **Runtime target**: Node.js 20.x (for AWS Lambda)

### Local development

Install dependencies:

```bash
npm install
```

Build the Lambda bundle (this creates `dist/index.js`):

```bash
npm run build
```

You can inspect `dist/index.js` if you want to see the compiled output that Lambda will actually run.

### AWS configuration

The Lambda expects:

- **Runtime**: Node.js 20.x
- **Handler**: `index.handler` (or another value matching where you place `dist/index.js` in your deployment ZIP)
- **Permissions**: IAM role with S3 `GetObject` and `PutObject` permissions on your bucket.
- **Environment / region**:
  - The S3 client is created as:

    ```ts
    const s3 = new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
    });
    ```

  - If `AWS_REGION` is not set, it defaults to `us-east-1`.
  - The bucket name is currently hard-coded in `src/aggregator.ts` (`BUCKET_NAME`).

### GitHub Actions CI/CD

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-backend.yml`.

What it does:

- Triggers on pushes to the `main` branch.
- Uses Node.js 20.
- Runs:
  - `npm ci`
  - `npm run build`
- Configures AWS credentials using repository secrets.
- Syncs the build output to S3 at `s3://$AWS_S3_BUCKET_NAME/backend/`, so it does **not** overwrite any existing frontend files at the bucket root.

Required GitHub Actions secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `AWS_S3_BUCKET_NAME`

Once those secrets are configured and you push to `main`, GitHub Actions will build this backend and upload the bundled `dist/` files into the `backend/` prefix of your S3 bucket.

### Deploying the Lambda

There are a few options for connecting this build to a live Lambda:

- **Manual ZIP upload**:
  - Build locally or let CI build.
  - Package `dist/index.js` (and any needed files) into a ZIP.
  - Upload the ZIP to your Lambda in the AWS console or via `aws lambda update-function-code`.
  - Make sure the handler string matches the file path inside the ZIP (e.g. `index.handler`).

- **S3-based deployment**:
  - Point your Lambda deployment process (CLI, CDK, SAM, etc.) at the S3 object under `backend/` that this workflow uploads.

For now this project intentionally focuses on the Lambda code and CI/CD artifacts; you can wire it into a larger infrastructure stack (API Gateway, CloudFront, etc.) as needed.
