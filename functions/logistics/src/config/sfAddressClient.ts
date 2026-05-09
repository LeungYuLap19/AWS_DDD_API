import axios from 'axios';

const SF_ADDRESS_LOGIN_URL = 'https://hksfadd.sf-express.com/api/address_api/login';
const SF_ADDRESS_AREA_URL = 'https://hksfaddsit.sf-express.com/api/address_api/area';
const SF_ADDRESS_NETCODE_URL = 'https://hksfaddsit.sf-express.com/api/address_api/netCode';
const SF_ADDRESS_DETAIL_URL = 'https://hksfaddsit.sf-express.com/api/address_api/address';

/**
 * Obtains the bearer token for the SF address metadata API using the shared
 * API key configured for this Lambda.
 */
export async function fetchAddressToken(): Promise<unknown> {
  const res = await axios.post(
    SF_ADDRESS_LOGIN_URL,
    {},
    {
      headers: {
        'api-key': process.env.SF_ADDRESS_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  return res.data?.data;
}

/** Fetches the SF area list for a previously issued address token. */
export async function fetchAreaList(token: string): Promise<unknown> {
  const res = await axios.get(SF_ADDRESS_AREA_URL, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data?.data;
}

/** Fetches SF net-code options for a validated area/type pair. */
export async function fetchNetCodeList(params: {
  token: string;
  typeId: string | number;
  areaId: string | number;
}): Promise<unknown> {
  const res = await axios.get(
    `${SF_ADDRESS_NETCODE_URL}?typeId=${params.typeId}&areaId=${params.areaId}`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
      },
    }
  );

  return res.data?.data;
}

/**
 * Resolves pickup-address details for every requested net code and returns the
 * provider payloads in the same order as the requested codes.
 */
export async function fetchPickupAddresses(params: {
  token: string;
  netCode: string[];
  lang: string;
}): Promise<unknown[]> {
  return Promise.all(
    params.netCode.map(async (item) => {
      const res = await axios.get(
        `${SF_ADDRESS_DETAIL_URL}?lang=${params.lang}&netCode=${item}`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.token}`,
          },
        }
      );

      return res.data?.data;
    })
  );
}
