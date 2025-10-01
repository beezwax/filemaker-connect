import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUserPool,
  CognitoUser,
} from 'amazon-cognito-identity-js';

async function getCognitoUser(Username) {
  const poolData = await fetch('https://www.ifmcloud.com/endpoint/userpool/2.2.0.my.claris.com.json')
    .then(res => res.json());
  const { Client_ID: ClientId, UserPool_ID: UserPoolId } = poolData.data;
  const Pool = new CognitoUserPool({ UserPoolId, ClientId });
  return new CognitoUser({ Username, Pool });
}

export default async function fetchCognitoToken(Username, Password) {
  const authenticationDetails = new AuthenticationDetails({ Username, Password });
  const cognitoUser = await getCognitoUser(Username);

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: function (result) {
        const cognitoAccessToken = result.getAccessToken().getJwtToken();
        const clarisIdToken = result.getIdToken().getJwtToken();
        const clarisRefreshToken = result.getRefreshToken().getToken();
        resolve({
          cognitoAccessToken,
          clarisIdToken,
          clarisRefreshToken,
        })
      },
      onFailure: function(err) {
        reject(err);
      },
      mfaRequired: function() {
        reject(new Error('Multi-factor auth required'));
        // const verificationCode = prompt('Please input verification code' ,'');
        // cognitoUser.sendMFACode(verificationCode, this);
      }
    });
  });
}

export async function refreshToken(Username, RefreshToken) {
  return new Promise(async (resolve, reject) => {
    const cognitoUser = await getCognitoUser(Username);
    const cognitoToken = new CognitoRefreshToken({ RefreshToken });
    cognitoUser.refreshSession(cognitoToken, function (err, session) {
      if (err) {
        return reject(err);
      }
      resolve(session.getIdToken().getJwtToken());
    })
  })
}
