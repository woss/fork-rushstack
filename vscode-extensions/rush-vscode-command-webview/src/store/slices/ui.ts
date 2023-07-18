import { createSlice, Slice, SliceCaseReducers } from '@reduxjs/toolkit';
import { useAppSelector } from '../hooks';

export interface IUIState {
  isToolbarSticky: boolean;
  currentParameterName: string;
  userSelectedParameterName: string;
  formValidateAsync?: () => Promise<boolean>;
}

const initialState: IUIState = {
  isToolbarSticky: false,
  currentParameterName: '',
  userSelectedParameterName: ''
};

export const uiSlice: Slice<IUIState, SliceCaseReducers<IUIState>, string> = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setIsToolbarSticky: (state, action) => {
      state.isToolbarSticky = Boolean(action.payload);
    },
    setCurretParameterName: (state, action) => {
      state.currentParameterName = action.payload;
    },
    setUserSelectedParameterName: (state, action) => {
      state.userSelectedParameterName = action.payload;
    },
    setFormValidateAsync: (state, action) => {
      state.formValidateAsync = action.payload;
    }
  }
});

export const {
  setIsToolbarSticky,
  setCurretParameterName,
  setUserSelectedParameterName,
  setFormValidateAsync
} = uiSlice.actions;

export default uiSlice.reducer;

export const useIsToolbarSticky = (): boolean => {
  const isSticky: boolean = useAppSelector((state) => state.ui.isToolbarSticky);
  return isSticky;
};

export const useCurrentParameterName = (): string => useAppSelector((state) => state.ui.currentParameterName);
export const useUserSelectedParameterName = (): string =>
  useAppSelector((state) => state.ui.userSelectedParameterName);
