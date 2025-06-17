package Hutech;

import java.util.Scanner;

public class Day_2_q6 {
    public static void main(String[] args) {
        Scanner sc =  new Scanner(System.in);
        System.out.println("enter the array range : ");
        int l=sc.nextInt();
        int []arr=new int[l];
        System.out.println("Enter element for array ");
        for(int i=0;i<l;i++){
            arr[i]=sc.nextInt();
        }
        int res = findBig(arr);
        System.out.println("The bigest element in the array "+res);


    }

    private static int findBig(int[] arr) {
        int res = arr[0];
        for(int i=1;i<arr.length;i++){
            if(res<arr[i])
            res=arr[i];
        
        }
       return res;
    }
    
}
