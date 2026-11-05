
import api from "./api";

export const getMyDevices = async () => {
  const response = await api.get("/devices");

  return response.data.data;
};

export const getCameraDetails = async (deviceId) => {
  const response = await api.get(`/devices/${deviceId}`);

  return response.data.data;
};

export const disableCamera = async (deviceId) => {
  const response = await api.patch(
    `/devices/${deviceId}/disable`
  );

  return response.data;
};

export const enableCamera = async (deviceId) => {
  const response = await api.patch(
    `/devices/${deviceId}/enable`
  );

  return response.data;
};
