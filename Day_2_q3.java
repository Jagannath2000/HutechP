package Hutech;

import java.util.Scanner;

public class Day_2_q3 {
    //Write a Java Program to convert Integer numbers and Binary numbers

    public static void main(String[] args) {
        Scanner ac = new Scanner(System.in);
        System.out.println("Enter a integer :");
        int num= ac.nextInt();
        desimalToBinary(num);
       
        
        
    }

    private static void  desimalToBinary(int num) {
        int []array =new int[1000];
        int i=0;


        while (num>0) {
            array[i] = num%2;
            num=num/2;
            i++;


            
        }

        for(int j=0;j<i;j++){
            System.out.print(array[j]);
        }
       
        
    }
    
}
