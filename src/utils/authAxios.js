import axios from "axios";
import { useTicketStore } from "../store";

const authAxios = axios.create();

authAxios.interceptors.request.use((config) => {
  const { token } = useTicketStore.getState();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

authAxios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn("[Auth] 401 received — session expired, logging out");
      useTicketStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default authAxios;
