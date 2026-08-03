import cv2
import numpy as np
import os
import argparse

def generate_maps(input_image_path, output_dir):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    base_name=os.path.splitext(os.path.basename(input_image_path))[0]
    albedo=cv2.imread(input_image_path)
    if albedo is None:
        raise FileNotFoundError(input_image_path)
    gray=cv2.cvtColor(albedo,cv2.COLOR_BGR2GRAY)
    grad_x=cv2.Sobel(gray,cv2.CV_32F,1,0,ksize=3)
    grad_y=cv2.Sobel(gray,cv2.CV_32F,0,1,ksize=3)
    grad_z=np.full(gray.shape,10.0,dtype=np.float32)
    normal=np.dstack((-grad_x,grad_y,grad_z))
    normal=normal/(np.linalg.norm(normal,axis=2,keepdims=True)+1e-8)
    normal=((normal+1)/2*255).astype(np.uint8)
    cv2.imwrite(os.path.join(output_dir,f'{base_name}_nrm.jpeg'),cv2.cvtColor(normal,cv2.COLOR_RGB2BGR))
    rough=cv2.convertScaleAbs(cv2.bitwise_not(gray),alpha=0.8,beta=50)
    rough=cv2.GaussianBlur(rough,(3,3),0)
    cv2.imwrite(os.path.join(output_dir,f'{base_name}_rgh.jpeg'),rough)
    inv=cv2.bitwise_not(gray)
    blur=cv2.GaussianBlur(inv,(21,21),0)
    ao=cv2.multiply(gray.astype(float)/255.0,cv2.bitwise_not(blur).astype(float)/255.0)*255.0
    ao=cv2.convertScaleAbs(ao,alpha=1.5,beta=-30)
    cv2.imwrite(os.path.join(output_dir,f'{base_name}_ao.jpeg'),ao)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input_image');p.add_argument('--output',default='generated_maps');a=p.parse_args();generate_maps(a.input_image,a.output)