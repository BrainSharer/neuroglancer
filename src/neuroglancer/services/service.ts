import { fetchOk } from 'neuroglancer/util/http_request';

export class AppSettings {
  // public static API_ENDPOINT ='https://activebrainatlas.ucsd.edu/activebrainatlas';
  public static API_ENDPOINT ='http://127.0.0.1:8000';
  // public static API_ENDPOINT ='https://flower-dev.pni.princeton.edu';
}

export class APIService {

  constructor() { }


  public async getAnimals(): Promise<any> {
    const url = AppSettings.API_ENDPOINT + '/animals'

    try {
      const response = await fetchOk(url, {
        method: 'GET',
      });
      return await response.json();
    } catch (err) {
      console.log('Error in fetching animals ' + err);
    }
  }




}


