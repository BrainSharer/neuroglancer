
export const AppSettings = {
        API_ENDPOINT: 'http://localhost:8000',
        GOOGLE_LOGIN: 'http://localhost:8000/accounts/google/login/?next=',
        LOCAL_LOGIN: 'http://localhost:8000/admin/login/?next=/devlogin',
        DISPLAY_FETCH: true,
        DISPLAY_GOOGLE: true
};


export function getAppSettings() {

    const origin = window.location.origin;
    
    let AppSettings = {
        API_ENDPOINT: 'http://localhost:8000',
        GOOGLE_LOGIN: 'http://localhost:8000/accounts/google/login/?next=',
        LOCAL_LOGIN: 'http://localhost:8000/admin/login/?next=',
        DISPLAY_FETCH: true,
        DISPLAY_GOOGLE: true
    }

    if (origin.includes('activebrainatlas')) {
        AppSettings = {
            API_ENDPOINT: 'https://activebrainatlas.ucsd.edu/activebrainatlas',
            GOOGLE_LOGIN: 'https://activebrainatlas.ucsd.edu/activebrainatlas/accounts/google/login/?next=',
            LOCAL_LOGIN: 'https://activebrainatlas.ucsd.edu/activebrainatlas/admin/login/?next=',
            DISPLAY_FETCH: true,
            DISPLAY_GOOGLE: false
        }
    }

    if (origin.includes('brainsharer')) {
        AppSettings = {
            API_ENDPOINT: 'https://www.brainsharer.org/brainsharer',
            GOOGLE_LOGIN: 'https://www.brainsharer.org/brainsharer/accounts/google/login/?next=',
            LOCAL_LOGIN: 'https://www.brainsharer.org/brainsharer/admin/login/?next=',
            DISPLAY_FETCH: false,
            DISPLAY_GOOGLE: true
        }
    }

    return AppSettings;

}



