## FileMaker Connect
Wrapper for [FileMaker API calls](https://help.claris.com/en/data-api-guide/content/write-data-api-calls.html)

### Example
```javascript
import FilemakerConnect from 'filemaker-connect';

const filemaker = new FilemakerConnect({
  username: process.env.FILEMAKER_USER,
  password: process.env.FILEMAKER_PASSWORD,
  db: process.env.FILEMAKER_DB,
  server: process.env.FILEMAKER_HOST,
  timeout: process.env.FILEMAKER_TIMEOUT_MS, // connector default, can be overwritten per request
});

const teams = await filemaker.findAll({
  layout: 'lw_team',
  query: [{ year: 2022 }],
  rejectOnEmpty: true,
  timeout: 5_000,
});
```
