
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


export const renameCamera = async (deviceId, deviceName) => {
  const response = await api.patch(`/devices/${deviceId}/rename`, { deviceName });
  return response.data;
};

export const removeCamera = async (deviceId) => {
  const response = await api.delete(`/devices/${deviceId}`);
  return response.data;
};

export const getCameraRecordings = async (deviceId, params = {}) => {
  const response = await api.get(`/recordings/${deviceId}`, { params });
  return response.data.data;
};
