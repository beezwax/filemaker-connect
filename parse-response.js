export default async function parseResponse(response) {
  let responseData;
  const contentType = response.headers.get("content-type");
  if (contentType.includes("application/json")) {
    responseData = await response.json();
  } else {
    responseData = await response.text();
  }

  return responseData;
}
